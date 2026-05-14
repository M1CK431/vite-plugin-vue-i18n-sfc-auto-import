import { parse } from "vue/compiler-sfc"

const isObject = (obj: any): boolean => obj?.toString() === "[object Object]"

const deepMerge = (obj1: any, obj2: any): any => {
  const result = { ...obj1 }
  for (const key in obj2) {
    if (!Object.prototype.hasOwnProperty.call(obj2, key) || obj2[key] === undefined) continue
    const v1 = result[key]
    const v2 = obj2[key]
    result[key] = isObject(v1) && isObject(v2) ? deepMerge(v1, v2) : v2
  }
  return result
}

const prefixMessagesKeys = (prefix: string, messages: any): any =>
  Object.fromEntries(
    Object.entries(messages).map(([k, v]) => [`${prefix}__${k}`, v])
  )

export const getI18nMixin = ({ global }: any, url: string): object => ({
  beforeCreate(this: any) {
    const { $t, $options: { __i18n, i18n } } = this

    const i18nLocaleMessages = __i18n?.[0]
      ? (__i18n.flatMap(({ locale, resource }: any) =>
        locale
          ? [{ locale, messages: resource }]
          : Object.entries(resource).map(([k, v]) => ({ locale: k, messages: v }))
      ))
      : Object.entries(
        ('messages' in i18n || 'sharedMessages' in i18n)
          ? deepMerge(i18n.sharedMessages ?? {}, i18n.messages ?? {})
          : i18n
      ).map(([locale, messages]) => ({ locale, messages }))

    const localeKeys = new Set<string>()
    i18nLocaleMessages.forEach(({ locale, messages }: any) => {
      Object.keys(messages).forEach(k => localeKeys.add(k))
      const prefixedMessages = prefixMessagesKeys(url, messages)
      global.mergeLocaleMessage(locale, prefixedMessages)
    })

    this.$t = (key: string, ...rest: any[]) =>
      $t(localeKeys.has(key) ? `${url}__${key}` : key, ...rest)
  }
})

/**
 * Vite plugin to auto-inject i18n support into Vue SFC files with <i18n> blocks or i18n property in component object.
 *
 * Detects translations from:
 *  - <i18n> SFC blocks (multi-locale or locale-agnostic)
 *  - i18n property in component object: { i18n: { messages: { "en": {...}, "fr": {...} } } }
 *
 * Strategy per block combination:
 *  - <script setup> only         → append useI18n() at start of setup content
 *  - <script setup> + <script>   → leave setup intact, apply mixin on <script>
 *  - <script> only               → inject getI18nMixin via Options API mixin
 *  - no script at all            → create a <script setup> with useI18n()
 *
 * Note: A component must use either <i18n> OR i18n property, not both.
 * If both are detected, the component is not transformed.
 */

const vueFileRegex = /\.vue$/
const exportDefaultRe = /export\s+default\s*\{/
const mixinsRe = /mixins\s*:\s*\[/
const i18nPropertyRe = /i18n\s*:\s*\{/

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

      // Check for <i18n> block OR i18n property in component object
      const hasI18nBlock = descriptor.customBlocks?.some(({ type }) => type === "i18n")
      const scriptContent = descriptor.script?.content || ""
      const hasI18nProperty = i18nPropertyRe.test(scriptContent)

      if (!hasI18nBlock && !hasI18nProperty) return null

      // Reject if both sources are present - user must choose one or the other
      if (hasI18nBlock && hasI18nProperty) {
        console.warn(
          `[vue-i18n-sfc-autoimport] Component ${id} has both <i18n> block and i18n property. Component was NOT transformed. Please use one or the other, not both.`
        )
        return null
      }

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
        const insertPos = descriptor.scriptSetup?.loc.start.offset ?? 0
        return {
          code:
            code.slice(0, insertPos) +
            `\nimport { useI18n } from "vue-i18n";\nconst { t: $t } = useI18n();\n` +
            code.slice(insertPos)
        }
      }

      // => has <script> (Options API)
      // Apply two insertions, LATER position first to avoid index drift.

      const scriptBodyContent = descriptor.script?.content ?? ""
      const scriptContentStart = descriptor.script?.loc.start.offset ?? 0

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
