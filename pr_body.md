This PR adds a collapsible left pane to the Week view and improves accessibility and UX:

- feat: left pane collapse implemented using a 0-width column so the schedule grid expands leftward when collapsed
- feat: transition and subtle opacity/scale for smoother open/close animation
- feat: accessibility: toggle button now has `aria-expanded` and `aria-controls`; left pane has `id` and `aria-hidden`; focus moves to the site search input when opening and returns to the toggle when closing
- fix: lint and tsconfig/ESLint ignores adjusted to avoid generated/backup files being linted/checked

Test: run `npm run dev` and open Week view; click the "畳む/展開" button in the mode bar to collapse/expand the left pane. Schedule cells will expand into the freed space.

If you want, I can add keyboard shortcuts (e.g. Alt+L) or further focus management for screen readers.
