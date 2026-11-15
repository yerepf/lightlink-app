# Interfaz del Lunar Co-Visibility Explorer

Rediseño de la capa de presentación del demo. No modifica la lógica del motor científico, el backend ni el contrato de datos. `src/palette.ts` solo centraliza los colores de overlays 3D.

## Paleta

La interfaz vigente es un espacio técnico de planificación, con verde apagado, Inter y superficies planas. `demo/main.ts` carga `tokens.css`, `ui.css` y finalmente `mission.css`: esta última define las sustituciones efectivas. `DESIGN.md` documenta el sistema vigente y `PRODUCT.md` separa la experiencia actual del futuro modo Explorer, todavía no implementado. `src/palette.ts` conserva los colores científicos de overlays 3D.

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-background` | `#101710` | Fondo de app |
| `--bg-1` / `--bg-2` / `--bg-3` | `#172017` / `#202b20` / `#2b382a` | Paneles y superficies |
| `--color-primary` | `#bdcaaa` | Acento UI |
| `--color-text` | `#edf0e7` | Texto principal |
| `--text-1` / `--text-2` | `#bec8b8` / `#91a08b` | Texto secundario / atenuado |
| `--hairline` / `--hairline-soft` | `#85977b55` / `#85977b33` | Bordes |
| `--data-sun` | `#e8a93c` | Sol y avisos |
| `--data-earth` | `#7fb0c4` | Tierra |
| `--data-horizon` | `#a893c0` | Horizonte |
| `--data-ok` | `#a8b99a` | Co-visibilidad y estados OK |
| `--data-danger` | `#d9694f` | Bloqueos, playhead y errores |
| `--data-warn` | `#e8a93c` | Batería en reserva |

Uso de contraste (la conformidad debe verificarse sobre las superficies efectivas):

- `--text-0` y `--text-1` se usan para texto pequeño sobre `--bg-1`/`--bg-2`.
- `--text-2` queda para iconos, puntos, ticks y elementos decorativos.
- `--data-danger-ink` y `--data-horizon-ink` son variantes derivadas para texto pequeño; los tokens puros se reservan para gráficos, bordes y texto grande.

## Estructura

- `index.html`: shell de la aplicación (header, viewport, panel de controles, panel de estado, montajes de brújula y timeline, toast).
- `demo/main.ts`: orquestación entre `LunarEngine`, `BackendClient`, `LiveClock` y los widgets.
- `demo/ui/tokens.css`: tokens de color, tipografía, espaciado, radios, sombras, movimiento, z-index y breakpoints.
- `demo/ui/ui.css`: estilos del shell, panel, acordeones, controles, estado, brújula, timeline y responsive.
- `demo/ui/mission.css`: presentación técnica vigente, HUD sobre escena, Inter local, paneles planos y ajustes responsive; se carga al final.
- `public/fonts/InterVariable.woff2` y `Inter-LICENSE.txt`: Inter variable servido localmente. Procedencia: repositorio oficial `rsms/inter`, rama `master`, `docs/font-files/InterVariable.woff2` y `LICENSE.txt`; no se ha fijado aquí un commit de origen.
- `demo/ui/dom.ts`: helpers de DOM, formato UTC y anuncios accesibles.
- `demo/ui/icons.ts`: iconografía SVG en línea.
- `demo/ui/components/`: `Panel`, `AccordionSection`, `Select`, `SegmentedControl`, `Slider`, `Switch`, `Button`, `Badge`, `ProgressBar`, `Tooltip`, `InputField`.
- `demo/ui/compassMath.ts` y `demo/ui/CompassWidget.ts`: brújula HUD.
- `demo/ui/timelineMath.ts` y `demo/ui/TimelineWidget.ts`: línea de tiempo interactiva.
- `src/palette.ts`: colores de overlays y guías 3D, sincronizados con los tokens de datos.
- `tests/ui-math.test.ts`: pruebas de la matemática de brújula y timeline.

## Composición de la pantalla

- Header compacto con marca, sitio activo, estado en vivo y controles de panel; DTE se muestra junto a Tierra en el HUD y el rendimiento no ocupa la cabecera.
- HUD sin tarjeta sobre la escena: hora UTC, Sol, Tierra/DTE, elevaciones y batería simulada. Se sincroniza con el mismo estado que los detalles.
- Panel izquierdo con acordeones: Sitio, Vista, Capas, Nuevo punto, Información.
- Panel de estado a la derecha, cerrado al iniciar y accesible con «Detalles»: co-visibilidad, Sol/Tierra, muestra horaria, cobertura, energía, ciencia y diagnóstico visual.
- Brújula HUD sobre la esquina inferior izquierda.
- Timeline de ancho completo con carriles de Sol, Tierra y co-visibilidad.

## Brújula

- Dial SVG de 112 px con marcas cada 10°, norte verdadero corregido por `spatial.grid_convergence_deg` y flecha fija de rumbo de cámara.
- Sol y Tierra se sitúan por azimut relativo al rumbo corregido.
- Cuerpos bajo el horizonte estimado se muestran atenuados y punteados.
- Tooltip y foco de teclado con azimut, elevación, estado sobre/bajo horizonte y visibilidad de la muestra del backend.
- En vista de mapa el norte se fija arriba.

## Timeline

- Carriles compactos por estado del backend (muestra horaria, sin interpolar booleanos).
- Transporte: muestra anterior, reproducir/pausar, muestra siguiente y bucle.
- Velocidades: `1×`, `10×`, `100×`, `1000×`, `10000×` (segundos simulados por segundo real).
- Arrastrar el playhead busca; arrastrar el fondo desplaza la ventana; rueda o `+`/`-` amplían; doble clic restaura la vista completa.
- Teclado: `←`/`→` avanzan una muestra (`Shift` ×10), `Home`/`End` van a los extremos y `PageUp`/`PageDown` amplían.
- Modo en vivo con `LiveClock`: solo disponible con efemérides reales y cobertura para la hora actual.
- Al llegar al final, la reproducción se detiene o reinicia si el bucle está activo.

## Responsive

- Hasta 720 px: panel de controles inferior, detalles como overlay con cierre, HUD en dos columnas, timeline de 210 px con filas para velocidades y lectura UTC, y brújula reducida.
- Menos de 1100 px: panel y estado más estrechos.
- Se respeta `prefers-reduced-motion`.

## Verificación

```powershell
npx tsc -p tsconfig.demo.json --noEmit
npm run build
npm test
```

No hay un script `lint` configurado en este repositorio. El build incluye `tsc` y la compilación del demo.

La documentación se extrajo del código y de las decisiones aprobadas. El launcher y el detector de Impeccable no estuvieron disponibles por falta de binario/acceso al caché; no se afirma que sus comprobaciones se hayan ejecutado.

Los colores 3D se limitan a overlays y guías: horizonte, rayo solar, enlace DTE, sky paths, marcadores científicos y LED de batería. No se modifican terreno, rampa de pendientes, iluminación, estrellas, Sol, bloom ni lens flare.

El build genera `dist-demo/`; el aviso de tamaño de chunk >500 kB es el mismo del build base y corresponde al bundle de Three.js.
