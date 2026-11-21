export const userStoragePrefix = uid => `users/${uid}/`;
export const projectStoragePrefix = (uid, projectId) => `users/${uid}/projects/${projectId}/`;

// Removes a project's files first, then its documents, so a failure never leaves files without a record.
export async function deleteProjectCompletely({ store, files }, uid, projectId) {
  await files.removePrefix(projectStoragePrefix(uid, projectId));
  await store.deleteProject(projectId);
}
