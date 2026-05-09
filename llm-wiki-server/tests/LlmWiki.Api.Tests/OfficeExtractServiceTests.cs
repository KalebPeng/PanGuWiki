using ClosedXML.Excel;
using LlmWiki.Api.Services;

namespace LlmWiki.Api.Tests;

public class OfficeExtractServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());

    public OfficeExtractServiceTests()
    {
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
            Directory.Delete(_dir, recursive: true);
    }

    [Fact]
    public async Task ExtractText_Xlsx_ReturnsWorksheetCells()
    {
        var path = Path.Combine(_dir, "sample.xlsx");

        using (var wb = new XLWorkbook())
        {
            var ws = wb.AddWorksheet("Sheet1");
            ws.Cell(1, 1).Value = "姓名";
            ws.Cell(1, 2).Value = "人数";
            ws.Cell(2, 1).Value = "盘古";
            ws.Cell(2, 2).Value = 42;
            wb.SaveAs(path);
        }

        var sut = new OfficeExtractService();
        var text = await sut.ExtractText(path, "xlsx");

        Assert.Contains("| 姓名 | 人数 |", text);
        Assert.Contains("| 盘古 | 42 |", text);
    }
}
