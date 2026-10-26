# Local generator adapter (v0.7)

The local adapter runs a command on the user's own PC. It sets THEME_PROMPT, THEME_WIDTH, THEME_HEIGHT, and THEME_TASK_ID environment variables and expects **raw PNG bytes on stdout**. Diagnostics should go to stderr. It uses no shell and enforces a timeout and 40 MB stdout limit.

Usage from Node.js:

```js
import {createLocalCommandProvider} from "./local_provider.mjs";
import {produceTheme} from "./produce.mjs";
const provider=createLocalCommandProvider({command:"python",args:["my_local_image_generator.py"]});
await produceTheme({slug:"moon",concept:"silver moon",wallpapers:2},provider,"./out");
```

**Not a built-in image model.** The user must install a compatible image generator and supply the script. This repository does not yet include a pretrained model, downloader, or verified working generator script. Local execution may need a capable GPU and electricity; `costCents:0` only means this adapter does not charge API fees. Do not claim a finished image product until end-to-end generation and ZIP verification pass.
