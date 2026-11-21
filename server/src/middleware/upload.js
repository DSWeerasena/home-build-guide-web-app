import multer from "multer";
import { HttpError } from "../errors.js";

// Accepted plan formats: the declared MIME type, the file extension and the file's own first bytes must all agree.
export const PLAN_TYPES = [
  { mime: "image/png", extensions: [".png"], ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", extensions: [".jpg", ".jpeg"], ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "application/pdf", extensions: [".pdf"], ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
];

const extensionOf = name => (/\.[a-z0-9]+$/i.exec(name || "")?.[0] || "").toLowerCase();
const unsupported = () => new HttpError(415, "unsupported_file", "Unable to upload this plan. Use a JPG, JPEG, PNG or PDF file.");

export function planUpload(maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
      const type = PLAN_TYPES.find(t => t.mime === file.mimetype);
      cb(type && type.extensions.includes(extensionOf(file.originalname)) ? null : unsupported(), Boolean(type));
    },
  }).single("file");
}

export function detectPlanType(file) {
  if (!file?.buffer?.length) throw new HttpError(400, "validation_failed", "No file was uploaded.");
  const type = PLAN_TYPES.find(t => t.mime === file.mimetype);
  const matches = type && type.magic.every((byte, i) => file.buffer[i] === byte);
  if (!matches) throw unsupported();
  return type;
}
