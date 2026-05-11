import { parse } from "vue/compiler-sfc"

export const getI18nMixin = (i18n: any, url: string): object => ({
  beforeCreate(this: any) {
    const { $t } = this

    const localeKeys = this.$options.__i18n.flatMap(({ locale, resource }: any) =>
      locale
        ? Object.keys(resource)
        : Object.values(resource).flatMap((Object.keys as any))
    )

    const prefixMessagesKeys = (messages: any): any =>
      Object.fromEntries(
        Object.entries(messages).map(([k, v]) => [`${url}__${k}`, v])
      )
    this.$options.__i18n.forEach(({ locale, resource }: any) =>
      locale
        ? i18n.global.mergeLocaleMessage(locale, prefixMessagesKeys(resource))
        : Object.entries(resource).forEach(([k, v]) =>
          i18n.global.mergeLocaleMessage(k, prefixMessagesKeys(v as any))
        )
    )

    this.$t = (key: string, ...rest: any[]) =>
      $t(localeKeys.includes(key) ? `${url}__${key}` : key, ...rest)
  }
})

/**
 * Vite plugin to auto-inject i18n support into Vue SFC files with <i18n> blocks.
 *
 * Strategy per block combination:
 *  - <script setup> only         → append useI18n() at start of setup content
 *  - <script setup> + <script>   → leave setup intact, apply mixin on <script>
 *  - <script> only               → inject getI18nMixin via Options API mixin
 *  - no script at all            → create a <script setup> with useI18n()
 */

const vueFileRegex = /\.vue$/
const exportDefaultRe = /export\s+default\s*\{/
const mixinsRe = /mixins\s*:\s*\[/

const vueI18nSfcAutoimport = (
  globalI18nImport: string = `import { i18n } from "@/main.js";`
): any => ({
  name: "vue-i18n-sfc-autoimport",
  enforce: "pre",

  transform: {
    filter: { id: vueFileRegex },
    async handler(code: string, id: string): Promise<{ code: string; map?: any } | null> {
      // Parse the SFC
      let descriptor
      try {
        descriptor = parse(code).descriptor
      } catch (error: any) {
        const { message } = error
        console.error(
          `[vue-i18n-sfc-autoimport] Failed to parse ${id}: ${message}`
        )
        return null
      }

      // Only process files with at least one <i18n> block
      if (!descriptor.customBlocks?.some(({ type }) => type === "i18n"))
        return null

      // Early exit: developer already handled i18n manually
      if (code.includes("useI18n(")) return null

      const hasScript = !!descriptor.script
      const hasScriptSetup = !!descriptor.scriptSetup

      // => no script blocks at all
      // Create a <script setup> block just before the first <i18n> tag.
      if (!hasScript && !hasScriptSetup) {
        const insertPos = code.indexOf("<i18n")
        const block = `<script setup>\nimport { useI18n } from "vue-i18n";\nconst { t: $t } = useI18n();\n</script>\n\n`
        return {
          code: code.slice(0, insertPos) + block + code.slice(insertPos)
        }
      }

      // => <script setup> only
      // Prepend useI18n() at the START of the setup content (after <script setup>).
      if (hasScriptSetup && !hasScript) {
        if (!descriptor.scriptSetup) return null
        const insertPos = descriptor.scriptSetup.loc.start.offset
        return {
          code:
            code.slice(0, insertPos) +
            `\nimport { useI18n } from "vue-i18n";\nconst { t: $t } = useI18n();\n` +
            code.slice(insertPos)
        }
      }

      // => has <script> (Options API)
      // Apply two insertions, LATER position first to avoid index drift.

      if (!descriptor.script) return null
      const scriptBodyContent = descriptor.script.content
      const scriptContentStart = descriptor.script.loc.start.offset

      // Locate `export default {`
      const exportMatch = scriptBodyContent.match(exportDefaultRe)
      if (!exportMatch || exportMatch.index === undefined) {
        console.warn(
          `[vue-i18n-sfc-autoimport] Could not find 'export default {' in ${id}`
        )
        return null
      }
      // Position of the `{` character in the full code string
      const exportOpenBracePos =
        scriptContentStart + exportMatch.index + exportMatch[0].length

      // Insertion 1 (LATER): modify `export default { … }`
      const mixinsMatch = scriptBodyContent.match(mixinsRe)

      if (mixinsMatch && mixinsMatch.index !== undefined) {
        // Prepend to existing mixins array: mixins: [getI18nMixin(i18n, url), …]
        const mixinsOpenBracketPos =
          scriptContentStart + mixinsMatch.index + mixinsMatch[0].length
        code =
          code.slice(0, mixinsOpenBracketPos) +
          `getI18nMixin(i18n, import.meta.url), ` +
          code.slice(mixinsOpenBracketPos)
      } else {
        // Add new mixins property right after `export default {`
        code =
          code.slice(0, exportOpenBracePos) +
          `\n  mixins: [getI18nMixin(i18n, import.meta.url)],` +
          code.slice(exportOpenBracePos)
      }

      // Insertion 2 (EARLIER): inject imports at top of <script> content
      // Applied AFTER insertion 1 so that scriptContentStart is still valid.
      // Check against the original scriptBodyContent to avoid false positives.
      const i18nAlreadyImported = /\bimport\b[^;]*\si18n\b/.test(
        scriptBodyContent
      )

      const importsBlock =
        `\nimport { getI18nMixin } from "vite-plugin-vue-i18n-sfc-auto-import";\n` +
        (i18nAlreadyImported ? "" : `${globalI18nImport}\n`)

      code =
        code.slice(0, scriptContentStart) +
        importsBlock +
        code.slice(scriptContentStart)

      return { code }
    }
  }
})

export default vueI18nSfcAutoimport
