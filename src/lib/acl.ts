export type DocumentRole = "owner" | "editor" | "viewer";

export function canRead(role: DocumentRole | null | undefined) {
  return role === "owner" || role === "editor" || role === "viewer";
}

export function canEdit(role: DocumentRole | null | undefined) {
  return role === "owner" || role === "editor";
}

export function canManageSharing(role: DocumentRole | null | undefined) {
  return role === "owner";
}

export function canDeleteDocument(role: DocumentRole | null | undefined) {
  return role === "owner";
}

export function isDocumentRole(value: unknown): value is DocumentRole {
  return value === "owner" || value === "editor" || value === "viewer";
}
