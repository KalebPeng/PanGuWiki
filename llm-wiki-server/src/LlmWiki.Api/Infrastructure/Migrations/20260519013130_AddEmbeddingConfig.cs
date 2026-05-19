using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LlmWiki.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEmbeddingConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "embedding_configs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    department_id = table.Column<Guid>(type: "uuid", nullable: true),
                    provider = table.Column<string>(type: "text", nullable: false),
                    endpoint = table.Column<string>(type: "text", nullable: false),
                    encrypted_api_key = table.Column<string>(type: "text", nullable: false),
                    model = table.Column<string>(type: "text", nullable: false),
                    dimensions = table.Column<int>(type: "integer", nullable: false, defaultValue: 1536),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_embedding_configs", x => x.id);
                    table.CheckConstraint("chk_embedding_config_scope", "num_nonnulls(user_id, department_id) = 1");
                });

            migrationBuilder.CreateIndex(
                name: "ix_embedding_configs_department_id",
                table: "embedding_configs",
                column: "department_id",
                unique: true,
                filter: "department_id IS NOT NULL AND is_active = true");

            migrationBuilder.CreateIndex(
                name: "ix_embedding_configs_user_id",
                table: "embedding_configs",
                column: "user_id",
                unique: true,
                filter: "user_id IS NOT NULL AND is_active = true");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "embedding_configs");
        }
    }
}
