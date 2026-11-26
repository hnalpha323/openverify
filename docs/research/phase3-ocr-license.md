# Phase 3 OCR model license provenance (checked 2026-10-20)
- Official PaddlePaddle HF repos (author PaddlePaddle) carry license apache-2.0 in cardData:
  - PaddlePaddle/PP-OCRv5_mobile_det @ 0d63e78e2b680928f6b1747d76a08db6e645efb7 (Paddle inference format)
  - PaddlePaddle/en_PP-OCRv5_mobile_rec @ 267c36e24c331595590fe7bd72bde2436fd286f2
  - PaddlePaddle/PP-LCNet_x1_0_textline_ori @ cd237a44b0e359d4fe38310a416203cf7403faa5
  - latin_PP-OCRv5_mobile_rec also apache-2.0
- RapidOCR (github RapidAI/RapidOCR) LICENSE = Apache-2.0 (Copyright 2021 RapidOCR Authors); it publishes paddle2onnx conversions on ModelScope (sha256 listed in default_models.yaml @ 7cfd3d9 v3.10.0 per Phase 0 vision report).
- Chain: original weights Apache-2.0 (copyright holder PaddlePaddle) -> ONNX conversion by an Apache-2.0 project => acceptable under policy. Record both links + commit SHAs in models/manifest.json notes.
- Alternative: community HF monkt/paddleocr-onnx (apache-2.0 tag, third party) — less authoritative.
