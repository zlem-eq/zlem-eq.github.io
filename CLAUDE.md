# CLAUDE.md

@AGENTS.md

## Claude-specific notes

- Project context, structure, conventions and gotchas are in `AGENTS.md` (imported above). Keep that file as the single source of truth and update it when the architecture changes, rather than duplicating details here.
- Preview: `.claude/launch.json` defines a `site` configuration (`npx serve -p 5500 .`). Use it to check UI changes in a browser, and look at the console after loading a page.
- Before editing a page, check which scripts it loads and in what order (see "Tools" in `AGENTS.md`); globals such as `window.RaidTargets` and `window.reapplyFilter` connect files.
- Pages that use Firestore write to the live guild database. Don't place, assign, complete or delete real records while verifying a change unless the user asks you to.
- After changing anything in `GuildPotions/`, remind the user that `GuildPotions.zip` needs rebuilding (top-level `guildpotions/` folder), and keep `gp_recipes.lua` in sync with `POTION_RECIPES` in `pages/guild-potions.html`.
- Pushing to `main` deploys the live site. Commit or push only when asked.
