using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LlmWiki.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceIngestRecordsWithIngestTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ingest_records");

            migrationBuilder.CreateTable(
                name: "ingest_tasks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_file_name = table.Column<string>(type: "text", nullable: false),
                    source_file_path = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false, defaultValue: "queued"),
                    wiki_pages_count = table.Column<int>(type: "integer", nullable: true),
                    triggered_by = table.Column<Guid>(type: "uuid", nullable: true),
                    queued_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    error_message = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ingest_tasks", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ingest_tasks_department_id",
                table: "ingest_tasks",
                column: "department_id");

            migrationBuilder.CreateIndex(
                name: "ix_ingest_tasks_department_id_source_file_name",
                table: "ingest_tasks",
                columns: new[] { "department_id", "source_file_name" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ingest_tasks");

            migrationBuilder.CreateTable(
                name: "ingest_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false),
                    ingested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    ingested_by = table.Column<Guid>(type: "uuid", nullable: true),
                    source_file_name = table.Column<string>(type: "text", nullable: false),
                    source_file_path = table.Column<string>(type: "text", nullable: false),
                    wiki_pages_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ingest_records", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ingest_records_department_id_source_file_name",
                table: "ingest_records",
                columns: new[] { "department_id", "source_file_name" });
        }
    }
}
