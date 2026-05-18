using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LlmWiki.Api.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLockedByToIngestTask : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "locked_by",
                table: "ingest_tasks",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "locked_by",
                table: "ingest_tasks");
        }
    }
}
