import { notFound } from "../errors.js";
import { validateBootstrap, validateUserUpdate } from "../middleware/validate.js";
import { deleteProjectCompletely, userStoragePrefix } from "../services/cleanup.js";

const DEFAULT_PROJECT_NAME = "My House Project";

export function usersController(deps) {
  const { store, files, auth } = deps;
  return {
    // Called after every sign-in: creates the profile and first project when missing, and records the login.
    async bootstrap(req, res) {
      const input = validateBootstrap(req.body);
      const { uid, email, emailVerified } = req.user;
      let user = await store.getUser(uid);
      if (!user) {
        user = await store.createUser(uid, {
          name: input.name || req.user.name || email.split("@")[0] || "",
          email,
          preferredLanguage: input.preferredLanguage || "en",
          emailVerified,
        });
      } else {
        await store.touchLogin(uid, { email, emailVerified });
        user = await store.getUser(uid);
      }
      let projects = await store.listProjects(uid);
      if (!projects.length) {
        projects = [await store.createProject({ ownerId: uid, projectName: DEFAULT_PROJECT_NAME, houseType: "residential", preferredLanguage: user.preferredLanguage || "en", progress: 0, completed: [], checklists: {} })];
      }
      res.json({ user, projects });
    },

    async me(req, res) {
      const user = await store.getUser(req.user.uid);
      if (!user) throw notFound("Profile");
      res.json({ user });
    },

    async updateMe(req, res) {
      if (!(await store.getUser(req.user.uid))) throw notFound("Profile");
      res.json({ user: await store.updateUser(req.user.uid, validateUserUpdate(req.body)) });
    },

    // Deletes every project, calculation and uploaded plan, then the profile, then the Firebase account.
    async deleteMe(req, res) {
      const { uid } = req.user;
      for (const project of await store.listProjects(uid)) await deleteProjectCompletely(deps, uid, project.id);
      await files.removePrefix(userStoragePrefix(uid));
      await store.deleteUser(uid);
      await auth.deleteUser(uid);
      res.status(204).end();
    },
  };
}
