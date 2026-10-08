// Central capability registry for Universal Intake.
// "native" means parsed deterministically in the Worker.
// "adapter" means binary extraction/unpack must run before canonical mapping.
export const INTAKE_CAPABILITIES = Object.freeze({
  csv:{mode:"native",extractor:"delimited"},
  tsv:{mode:"native",extractor:"delimited"},
  json:{mode:"native",extractor:"json"},
  xml:{mode:"native",extractor:"xml_flat"},
  txt:{mode:"native",extractor:"plain_text"},
  xlsx:{mode:"adapter",extractor:"spreadsheet_binary",accepts:["tables"]},
  xls:{mode:"adapter",extractor:"spreadsheet_binary",accepts:["tables"]},
  pdf:{mode:"adapter",extractor:"pdf_text_or_ocr",accepts:["text","tables"]},
  png:{mode:"adapter",extractor:"image_ocr",accepts:["text","tables"]},
  jpg:{mode:"adapter",extractor:"image_ocr",accepts:["text","tables"]},
  jpeg:{mode:"adapter",extractor:"image_ocr",accepts:["text","tables"]},
  webp:{mode:"adapter",extractor:"image_ocr",accepts:["text","tables"]},
  doc:{mode:"adapter",extractor:"document_binary",accepts:["text","tables"]},
  docx:{mode:"adapter",extractor:"document_binary",accepts:["text","tables"]},
  zip:{mode:"adapter",extractor:"archive_unpack",accepts:["files"]}
});
export function capabilityFor(name=""){
  const ext=String(name).toLowerCase().split(".").pop();
  return INTAKE_CAPABILITIES[ext]||{mode:"review",extractor:"unsupported"};
}
