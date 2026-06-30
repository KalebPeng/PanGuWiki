using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LlmWiki.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddImageGenerationAssets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "generated_images",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prompt = table.Column<string>(type: "text", nullable: false),
                    model = table.Column<string>(type: "text", nullable: false),
                    size = table.Column<string>(type: "text", nullable: false),
                    file_path = table.Column<string>(type: "text", nullable: false),
                    mime_type = table.Column<string>(type: "text", nullable: false),
                    source_url = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_generated_images", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "image_generation_configs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false),
                    base_url = table.Column<string>(type: "text", nullable: false),
                    encrypted_api_key = table.Column<string>(type: "text", nullable: false),
                    model = table.Column<string>(type: "text", nullable: false),
                    default_size = table.Column<string>(type: "text", nullable: false, defaultValue: "1024x1024"),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_image_generation_configs", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_generated_images_department_id_id",
                table: "generated_images",
                columns: new[] { "department_id", "id" });

            migrationBuilder.CreateIndex(
                name: "ix_generated_images_department_id_user_id_created_at",
                table: "generated_images",
                columns: new[] { "department_id", "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_image_generation_configs_department_id",
                table: "image_generation_configs",
                column: "department_id",
                unique: true,
                filter: "is_active = true");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "generated_images");

            migrationBuilder.DropTable(
                name: "image_generation_configs");
        }
    }
}
