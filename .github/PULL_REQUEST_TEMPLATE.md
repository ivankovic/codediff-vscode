<!--
What changed and why. The why is the part that is hard to recover from the diff later.
-->

## The three gates

CI runs these; running them first is faster than a round trip.

```sh
npx tsc -p ./ --noEmit   # types
npm run lint             # eslint
npm test                 # compile + node --test
```

## If this touches the editor glue

Decorations, menus and prompts have no automated coverage - none of it can run outside a VS Code
host - so say how you exercised it. `code --extensionDevelopmentPath=$PWD <some folder>` opens an
Extension Development Host; launch it from a terminal, or it will not inherit your `PATH` and the
binary lookup fails for reasons that have nothing to do with your change.
