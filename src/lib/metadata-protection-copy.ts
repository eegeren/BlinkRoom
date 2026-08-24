export const metadataProtectionCopy = {
  label: "Metadata protected",
  shortDescription:
    "File names and file types are encrypted before leaving your device.",
  tooltip:
    "Your file name and file type are encrypted locally before being sent to BlinkRoom.",
  heading: "Metadata protection",
  description:
    "File names and file types are encrypted in your browser before they leave your device. BlinkRoom servers receive only encrypted metadata, never the original name or type.",
  uploadError: "Secure metadata encryption failed. Please try again.",
} as const;
