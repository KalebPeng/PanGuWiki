# AI Image Generation Design

## Summary

Add a Web-only, multi-tenant AI image generation workspace tool. The feature uses a department-level OpenAI Images API compatible relay configuration, generates images synchronously through the ASP.NET Core backend, and stores generated image files in a backend-managed asset store that is independent from Wiki project files.

Generated images are private to the creating account within the current department. Other department members cannot list, preview, download, or delete another user's generated images.

## Scope

In scope:

- Add a left workspace navigation item named `AI 图片生成` directly below `Wiki 知识库`.
- Add a dedicated department route: `/d/:deptId/images`.
- Add a standalone image generation page with prompt, model, size, count, generate action, and personal asset library.
- Add department-level image generation settings in workspace settings.
- Store relay API credentials only on the backend.
- Call an OpenAI Images API compatible synchronous endpoint from the backend.
- Store generated image files outside the Wiki project directory.
- Persist generated image metadata in PostgreSQL.

Out of scope for the first version:

- Single-player/local mode support.
- Streaming progress updates.
- Image editing or variation generation.
- Inserting images directly into Wiki pages.
- Shared department image galleries.
- Quota, billing, or rate-limit dashboards.

## Entry And Navigation

The department home sidebar gets a new navigation item in this order:

1. `Wiki 知识库`
2. `AI 图片生成`
3. `任务中心`
4. `人员目录`
5. `工作区设置`

Clicking `AI 图片生成` navigates to `/d/:deptId/images`. The item uses the same selected-state styling as `Wiki 知识库`.

The image generation route renders a standalone workspace page. It does not enter the existing Wiki editor three-column layout and does not alter the existing Wiki browsing flow.

## User Experience

The page title is `AI 图片生成`, with supporting text such as `使用工作区配置的生图模型创建素材`.

When the department has no enabled image generation configuration, the page shows a configuration-required empty state. Users with settings permission see a call to action to open workspace settings. Other users see a message asking them to contact an administrator.

The generation form contains:

- Prompt textarea.
- Model field, defaulting to the department setting and allowing a per-request override.
- Size selector with initial options: `1024x1024`, `1024x1536`, `1536x1024`.
- Count selector from `1` to `4`.
- `生成图片` button.

Generation is synchronous. While the request is running, the form is disabled and the page shows a pending state. On success, new images are inserted at the beginning of the user's asset library.

The personal asset library shows only the current user's images in the active department. Cards show the thumbnail, created time, model, and size. Opening a card shows a larger preview and the full prompt. Each image supports download and delete actions.

## Workspace Settings

Workspace settings adds an `AI 图片生成` section.

Fields:

- Enabled toggle.
- API Base URL.
- API Key.
- Default model.
- Default size.

The API Key is never exposed back to the frontend after saving. The UI may show an `已配置` state and allow entering a replacement key.

Only department roles that can manage workspace settings, such as `owner` and `admin`, can update image generation configuration. Regular members can use an enabled configuration but cannot read or modify secrets.

## Backend API

Add a Wiki module controller for image generation and assets.

Configuration endpoints:

- `GET /api/departments/{deptId}/image-generation/config`
- `PUT /api/departments/{deptId}/image-generation/config`

The GET response returns non-secret configuration fields and a boolean indicating whether an API key is configured. It does not return the API key.

Asset endpoints:

- `POST /api/departments/{deptId}/images/generate`
- `GET /api/departments/{deptId}/images`
- `GET /api/departments/{deptId}/images/{id}/content`
- `DELETE /api/departments/{deptId}/images/{id}`

`POST /images/generate` accepts:

- `prompt`
- `model` optional override
- `size` optional override
- `n` optional count, clamped to `1-4`

The backend calls the configured relay as an OpenAI Images API compatible endpoint:

`POST {baseUrl}/v1/images/generations`

The request includes the configured API key server-side. The backend supports relay responses containing either `data[].url` or `data[].b64_json`. URL responses are downloaded by the backend before saving.

All asset list, content, and delete operations filter by `department_id` and current `user_id`.

## Database

Add `image_generation_configs`.

Columns:

- `id`
- `department_id`
- `base_url`
- `api_key_encrypted`
- `model`
- `default_size`
- `is_active`
- `created_at`
- `updated_at`

There is at most one active image generation config per department.

Add `generated_images`.

Columns:

- `id`
- `department_id`
- `user_id`
- `prompt`
- `model`
- `size`
- `file_path`
- `mime_type`
- `source_url`
- `created_at`

Indexes:

- `(department_id, user_id, created_at desc)` for the personal asset library.
- `(department_id, id)` for content and delete lookup.

## File Storage

Generated image files are stored outside the Wiki project directory.

Configuration:

- `ImageAssets:RootPath`
- Docker default: `/data/image-assets`
- Local development default: `./data/image-assets`

Path layout:

`<ImageAssets:RootPath>/<departmentId>/users/<userId>/<yyyy>/<MM>/<imageId>.png`

The stored `file_path` points to the backend-managed asset file. The frontend never reads this path directly. Image bytes are served only through authorized API endpoints.

Docker deployment adds a separate image asset volume or bind mount. Wiki backup and image asset backup can be managed independently.

## Error Handling

Expected cases:

- Missing or disabled config: return a clear `400` response and show a setup prompt.
- Unauthorized relay response: show a configuration or quota error without exposing secrets.
- Timeout: show a retryable generation timeout message.
- Unsupported relay response shape: return a controlled backend error and log the response summary.
- Download failure for URL responses: return a retryable storage/download error.
- Delete forbidden: only the owner of an image can delete it.

The backend must avoid logging API keys or full Authorization headers.

## Testing

Backend tests:

- Config GET never returns API key.
- Config PUT is role-limited to settings managers.
- Generate fails cleanly when config is missing.
- Generate saves `b64_json` results to the independent asset root and records metadata.
- Generate downloads `url` results and records metadata.
- List returns only current user's images for the current department.
- Content and delete reject another user's image.

Frontend tests:

- Sidebar shows `AI 图片生成` below `Wiki 知识库`.
- Images page shows the unconfigured state.
- Generate form posts prompt/model/size/count and renders returned images.
- Asset library download/delete actions call the expected endpoints.

## Open Questions Deferred

- Whether generated images should later be publishable to a shared department library.
- Whether assets should support direct insertion into Wiki pages.
- Whether to add quota, cost tracking, or rate limits.
