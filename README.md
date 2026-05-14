<h1 align="center">🧩 vite-plugin-vue-i18n-sfc-auto-import</h1>

<p align="center">
<a href="https://github.com/M1CK431/vite-plugin-vue-i18n-sfc-auto-import/releases" alt="GitHub release"><img src="https://img.shields.io/github/v/release/M1CK431/vite-plugin-vue-i18n-sfc-auto-import.svg" ></a>
<a href="LICENSE" alt="License: MIT"><img src="https://img.shields.io/badge/License-MIT-blue"></a>
<a href="https://www.npmjs.com/package/vite-plugin-vue-i18n-sfc-auto-import" alt="NPM downloads"><img src="https://img.shields.io/npm/dw/vite-plugin-vue-i18n-sfc-auto-import?color=limegreen" ></a>
</p>

A Vite plugin that **automatically handles i18n scoping in Vue SFC components**, ensuring component-scoped translations are properly injected when using **vue-i18n v11+ in composition mode** with the Option API. Supports both `<i18n>` SFC blocks and the `i18n` property in the component object. This is done at Vite code transformation step so nothing will be added in your codebase! 👻

### The Problem

Vue-i18n v11 introduced a deprecation warning for its "legacy" mode (enabled by default), hinting that [support will be dropped in v12](https://vue-i18n.intlify.dev/guide/essentials/started.html#component-api-style). However, this decision inadvertently creates friction for applications using Vue's **Option API**, which is [**explicitly stated to NOT be deprecated**](https://vuejs.org/guide/extras/composition-api-faq.html#will-options-api-be-deprecated) by the Vue team.

The issue becomes critical when using Vue-i18n's composition mode: while `$t` remains globally available in templates and regular Option API `<script>` blocks, **component-scoped translations are silently ignored**—whether they are declared in `<i18n>` blocks or via the `i18n` option directly in the component object. In both cases, the translations simply stop working.

This forces developers to either:

1. **Live with the warning** until v12, then be forced to migrate all components to the Composition API
2. **Work around it** by manually adding a `setup` hook to each affected component to inject a local i18n instance and replace all `$t()` calls with `t()`—a tedious refactoring across the entire codebase

Both solutions are painful and time-consuming.

On top of that, any component-scoped translations previously declared via the `i18n` option must also be relocated—either to an `<i18n>` block or to the `messages` argument of `useI18n()`—regardless of which path is taken.

### The Solution

This plugin automatically injects the necessary i18n setup into your Vue components, guaranteeing that component-scoped translations work seamlessly with the Option API **when using vue-i18n v11+ in composition mode**, without console warning or breaking changes. You can continue writing Vue SFC as intended, without unnecessary refactoring.

## Installation

> **Compatibility:** This plugin was tested with Node 22+, Vite 7+, Vue 3.5+ and vue-i18n 11.
> It might (should) works with older versions too, but it's untested and no support will be provided.


You can install the plugin with your preferred package manager, for ex.:

```sh
npm install vite-plugin-vue-i18n-sfc-auto-import --save-dev
```

or

```sh
yarn add vite-plugin-vue-i18n-sfc-auto-import --dev
```

or

```sh
pnpm add -D vite-plugin-vue-i18n-sfc-auto-import
```

## Usage

### Setup

**Step 1 — Enable composition mode in vue-i18n**

Set `legacy: false` when creating your i18n instance:

```js
import { createI18n } from "vue-i18n";
import App from "./App.vue";

// Notice export and legacy: false here
export const i18n = createI18n({
  legacy: false,
  /* ...other options */
});

const app = createApp(App);
app.use(i18n);
app.mount("#app");
```

**Step 2 — Register the plugin in your Vite config**

Import and register the plugin in your `vite.config.js` or `vite.config.ts`. By default, the plugin expects the i18n instance to be exported from `@/main.js` (as shown above). If your setup differs, pass the corresponding import statement as argument:

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import vueI18nSfcAutoimport from "vite-plugin-vue-i18n-sfc-auto-import";

export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin(),
    vueI18nSfcAutoimport()
    // or with custom import statement
    // vueI18nSfcAutoimport(`import { i18n } from "@/plugins/i18n.js";`)
  ]
});
```

**Step 3 — Enjoy using `$t` in your components as usual 🎉**

No changes needed in your components. The plugin handles everything automatically.

```vue
<template>
  {{ $t("HELLO_WORLD") }}
</template>

<i18n>
{
  "en-US": { "HELLO_WORLD": "Hello world" },
  "fr-FR": { "HELLO_WORLD": "Bonjour le monde" }
}
</i18n>
```

## How it works

At build time, the plugin intercepts every `.vue` file that contains at least one `<i18n>` block or an `i18n` property in the component object. It then inspects the component's script structure and applies one of the following strategies.

> **Note:** If the file already contains a call to `useI18n()`, it is skipped entirely. This lets you handle specific components manually—with full freedom to customize the i18n setup—while the plugin transparently manages all others. In that case, managing local `<i18n>` translations is entirely your responsibility for that component.

> **Important Limitation:** A component must use **either** an `<i18n>` SFC block **OR** the `i18n` property in the component object (with `messages` and/or `sharedMessages`), but **NOT** both. If both are detected, the component will not be transformed and a warning will be logged. This design choice prevents confusion and unexpected behavior from having translation sources split across multiple locations.

---

### Case 1 — No script block

A `<script setup>` block is created just before the first `<i18n>` tag, with a local `useI18n()` instance exposing `$t`.

**Before:**
```vue
<template>
  {{ $t("HELLO") }}
</template>

<i18n>
{ "en-US": { "HELLO": "Hello" } }
</i18n>
```

**After (effective code):**
```vue
<template>
  {{ $t("HELLO") }}
</template>

<script setup>
import { useI18n } from "vue-i18n";
const { t: $t } = useI18n();
</script>

<i18n>
{ "en-US": { "HELLO": "Hello" } }
</i18n>
```

---

### Case 2 — `<script setup>` only

The `useI18n()` import and destructuring are prepended at the start of the existing `<script setup>` content.

**Before:**
```vue
<script setup>
const count = ref(0);
</script>

<i18n>
{ "en-US": { "HELLO": "Hello" } }
</i18n>
```

**After (effective code):**
```vue
<script setup>
import { useI18n } from "vue-i18n";
const { t: $t } = useI18n();

const count = ref(0);
</script>

<i18n>
{ "en-US": { "HELLO": "Hello" } }
</i18n>
```

---

### Case 3 — `<script>` only (Option API)

This is the most nuanced case. The plugin injects a mixin (`getI18nMixin`) via the `mixins` option. This mixin runs in the `beforeCreate` hook and:

1. Collects all local translation keys declared in the component's `<i18n>` block(s)
2. Registers them into the global i18n instance, prefixed with the component's file URL to scope them to the component (and incidentally avoid key collisions across components)
3. Replaces `this.$t` with a smart wrapper that automatically applies the prefix when a local key is used, and delegates to the original `$t` for global keys

This approach is fully transparent: you keep using `$t("KEY")` in templates and `<script>` alike—no migration needed.

**Before:**
```vue
<script>
export default {
  computed: { label: ({ $t }) => $t("HELLO") }
}
</script>

<i18n>
{ "en-US": { "HELLO": "Hello" } }
</i18n>
```

**After (effective code):**
```vue
<script>
import { getI18nMixin } from "vite-plugin-vue-i18n-sfc-auto-import";
import { i18n } from "@/main.js";

export default {
  mixins: [getI18nMixin(i18n, import.meta.url)],
  computed: { label: ({ $t }) => $t("HELLO") } // transparently resolved to the local translation
  }
}
</script>

<i18n>
{ "en-US": { "HELLO": "Hello" } }
</i18n>
```

---

### Case 4 — `<script setup>` + `<script>` (mixed)

When both blocks coexist, the `<script setup>` is left untouched and the mixin strategy (Case 3) is applied to the `<script>` block only.

> **Note:** If you also need access to local `<i18n>` translations from within `<script setup>`, you should import and instantiate `useI18n()` manually inside it. This will cause the plugin to skip the entire component (see the note at the top of this section). In that case, you are responsible for managing local translations—including, if needed, injecting `getI18nMixin` manually in the `<script>` block the same way the plugin would have done it automatically.

## Bonus feature 🎁

The `i18n` option in the component object traditionally accepts either `{ messages: { ... } }` or `{ sharedMessages: { ... } }` (or both). As a convenience, **this plugin also supports passing the locale map directly**—i.e. `i18n: { "en-US": { ... }, "fr-FR": { ... } }`—without wrapping it in a `messages` key. If neither `messages` nor `sharedMessages` is detected, the object is treated as the messages map directly.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Feel free to open an issue or submit a pull request if you have any suggestions or improvements.

### Project setup

```sh
pnpm i
```

### Compiles and hot-reloads for development

```sh
pnpm dev
```

### Compiles and minifies for production

```sh
pnpm build
```

### Lints and fixes files

```sh
pnpm lint
```

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE-OF-CONDUCT.md).
By participating in this project you agree to abide by its terms.

## Sponsoring

If you find this project useful, please consider giving it a **star ⭐ on GitHub** to show your support!

If you'd like to go a step further, you can also **buy me a coffee** ☕ via [Buy Me a Coffee](https://www.buymeacoffee.com/m1ck431). Your support helps me keep building great open-source projects like this one. Thank you! 🙏

<a href="https://www.buymeacoffee.com/m1ck431" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>

