# Undoing a bad publish

If something wrong got through (the check cannot catch a wrong banner date, for example), undo the commit that
caused it. Nothing is deleted, and the history stays.

```powershell
git log --oneline -5            # find the commit that made the mistake
git revert <that-commit-id>     # makes a new commit that undoes it (close the editor that opens)
git push
```

The push runs the check and publishes again. The new publish gets a **higher** version number than the bad
one, so every app that already downloaded the bad data replaces it at its next check (within about a day).
Pages may serve the old files for a few minutes.

- A revert of a merge commit needs `git revert -m 1 <id>`.
- To undo several commits, revert each one, newest first.
- Do not use `git reset --hard` and `git push --force` for this: the live data would stay as it is until a new
  publish, and the version number logic is built for forward-only history.
- Pictures are named with the SHA-256 of their contents, so a reverted picture comes back under its old
  address and apps that kept the old one simply use it.
