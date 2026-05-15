using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LlmWiki.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIngestRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ingest_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    department_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source_file_name = table.Column<string>(type: "text", nullable: false),
                    source_file_path = table.Column<string>(type: "text", nullable: false),
                    wiki_pages_count = table.Column<int>(type: "integer", nullable: false),
                    ingested_by = table.Column<Guid>(type: "uuid", nullable: true),
                    ingested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ingest_records");
        }
    }
}
