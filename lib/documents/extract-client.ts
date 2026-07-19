import * as XLSX from "xlsx";

/**
 * Word/Excel aren't formats Claude can read directly, so they're converted to
 * plain text client-side (both libraries run fine in-browser) before being
 * sent to the analyze endpoint. PDFs and images are sent as-is — the model
 * reads those natively.
 */
export async function extractTextIfNeeded(file: File): Promise<string | null> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value;
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `## ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
    }).join("\n\n");
  }

  return null;
}

export function isSupportedDocumentFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    file.type.startsWith("image/")
  );
}
