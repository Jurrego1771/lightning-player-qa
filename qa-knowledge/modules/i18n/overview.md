# i18n — Overview

## Qué hace

Gestiona la internacionalización (i18n) de la interfaz de usuario del Lightning Player. Traduce todos los strings visibles al usuario (controles, mensajes de estado, errores, modales) al idioma configurado en la opción `language`. El sistema usa **react-i18next** con un backend y detector custom que leen archivos JSON por idioma y namespace.

## Idiomas soportados

| Código | Idioma | Namespaces disponibles |
|--------|--------|----------------------|
| `es` | Español | `default`, `video`, `radio`, `reels`, `compact`, `federation` |
| `en` | Inglés | `default`, `video`, `radio`, `reels`, `compact`, `federation` |
| `pt` | Portugués | `default`, `video`, `radio`, `reels`, `compact`, `federation` |

**Default cuando `language` no se especifica:** `'es'`

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/view/common/hook/useTranslation/index.js` | Hook central: inicializa i18next, resuelve idioma del contexto, expone `{ t, i18n, loading, ready }` |
| `src/view/common/hook/useTranslation/settingsBackend.js` | Backend i18next: carga JSON por `language/namespace` con dynamic import + merge con traducciones del componente |
| `src/view/common/hook/useTranslation/settingsLanguageDetector.js` | Detector async custom: bloquea i18next hasta que el idioma esté resuelto desde el contexto del player |
| `src/view/common/components/Translate.js` | Componente React declarativo que envuelve `useTranslation` |
| `src/view/i18n/{lang}/{namespace}.json` | Archivos de traducción (18 archivos: 3 idiomas × 6 namespaces) |
| `src/federation/index.js` | Expone `api.federation.translation` con traducciones custom inyectadas por el integrador |
| `src/context/index.jsx` | Context provider: `(context.options || {}).language || 'es'` es el source del idioma |

## Flujo de datos

```
loadMSPlayer(container, { language: 'en' })
    ↓ options.language → ContextProvider state
    ↓ contextMapper: (context.options || {}).language || 'es'
    ↓ useTranslation/index.js: useEffect detecta language change
    ↓ SettingsLanguageDetector.resolve(language) [primera vez]
       o changeLanguage(language) [cambios subsiguientes]
    ↓ i18next cambia idioma activo
    ↓ SettingsBackend.read(language, namespace, cb)
       → dynamic import(@/view/i18n/{language}/{namespace}.json)
       → getComponent(namespace).getTranslation() [traducciones del componente]
       → merge(lng, conf) → callback
    ↓ useTranslation retorna { t, loading: false, ready: true }
    ↓ Componentes UI renderizan strings traducidos
```

## API pública expuesta

```js
// Vía federation plugin (único punto de acceso externo a traducciones)
api.federation.translation          // Object — traducciones custom del integrador (view.federation.translation)
api.federation.missingTranslation   // Object — claves faltantes detectadas en runtime
api.federation.defaultTranslation   // Object — federation.json en inglés (fallback)
```

## Namespaces y sus strings

| Namespace | Uso | Strings clave |
|-----------|-----|---------------|
| `default` | Compartido (todos los views) | `share`, `link-copied`, `download`, `status.*`, `adblocker_detected`, `no_data` |
| `video` | Skin video y TV | `chapters.*`, `records.*`, `quiz.*`, `reactions.*`, `live.*`, `nextEpisode.*`, `chromecast.*`, `tvControls.*` |
| `compact` | Vista compacta | `on_air`, `play`, `pause`, `previous`, `next`, `loading`, `share*` |
| `radio` | Vista radio | `tabs.*`, `back_to_live`, `play`, `season`, `on_air` |
| `reels` | Vista reels | `visit` |
| `federation` | Login / registro / perfil | `login.*`, `register.*`, `profile.*`, `error.*`, `recoverPassword.*` |

## Integración de traducciones custom (via `view.federation.translation`)

El integrador puede proveer traducciones custom para el namespace `federation` a través de:

```js
loadMSPlayer(container, {
  view: {
    federation: {
      translation: JSON.stringify({ login: { title: 'Entrar' } })
    }
  }
})
```

El `SettingsBackend._loadConf()` llama `component.getTranslation()` y hace merge sobre el JSON de idioma, permitiendo overrides por integrador.

## Comportamiento con idioma desconocido

Si `language` no corresponde a un JSON existente (ej: `'fr'`, `'de'`):
- `_loadLang()` en `settingsBackend.js` hace dynamic import que lanza error
- El error es capturado: `console.error('Error loading language', err)` → retorna `{}`
- i18next usa `missingKeyNoValueFallbackToKey: true` → los strings muestran la **key** en lugar de texto traducido
- **No hay fallback automático a `'es'` ni a `'en'`**

## Interpolación y aliasing

La configuración de i18next usa:
- `nestingPrefix: 'alias('` / `nestingSuffix: ')'` para referencias anidadas
- `escapeValue: false` — los strings pueden contener HTML (usado en `federation.json` para links)
- `returnEmptyString: true` — strings vacíos se devuelven tal cual (no se sustituyen por la clave)

## Interacciones con otros sistemas

- **Subtítulos**: el campo `subtitle.language` es el código ISO del audio/texto de la pista (independiente del idioma de la UI)
- **Chromecast**: `options.language || 'en'` en `CastManager.js` configura el idioma del receiver; es independiente del i18n de la UI
- **Ads (IMA)**: `navigator.language` en `adsLoader.js` para el SDK de Google IMA; independiente de `options.language`
- **Federation**: provee el único access point de API pública para traducciones custom
