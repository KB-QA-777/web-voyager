# web-voyager

This repository now holds the **shared-ticket multi-session Playwright challenge**:
one flow automated in two browser sessions at once, with proof that both always end
in the right state.

Everything lives in [`playwright-challenge/`](playwright-challenge/README.md):

```bash
cd playwright-challenge
npm ci
npm test
```

See `playwright-challenge/README.md` for the checks, the evidence pack and the ground
rules, and `playwright-challenge/TRANSPARENCY.md` for where the first attempt went wrong.

The earlier Python "Voyager" agent experiment was removed from this branch; it remains
available in the git history.
