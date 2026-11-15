# Interfaz del Lunar Co-Visibility Explorer

Rediseño de la capa de presentación del demo. No modifica la lógica del motor científico, el backend ni el contrato de datos. `src/palette.ts` solo centraliza los colores de overlays 3D.

## Paleta

La interfaz usa verde bosque y crema. Los valores base viven en `demo/ui/tokens.css`; `src/palette.ts` replica únicamente los colores de overlays que Three.js no puede leer desde CSS.

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-background` | `#141e12` | Fondo de app |
| `--bg-1` / `--bg-2` / `--bg-3` | `#1b2819` / `#263323` / `#2f3e2b` | Paneles y superficies |
| `--color-primary` | `#ebd7b0` | Acento UI |
| `--color-text` | `#f5ebdd` | Texto principal |
| `--text-1` / `--text-2` | `#f5ebddb3` / `#f5ebdd80` | Texto secundario / decorativo |
| `--hairline` / `--hairline-soft` | `#ebd7b029` / `#f5ebdd17` | Bordes |
| `--data-sun` | `#e8a93c` | Sol y avisos |
| `--data-earth` | `#7fb0c4` | Tierra |
| `--data-horizon` | `#a893c0` | Horizonte |
| `--data-ok` | `#a8b99a` | Co-visibilidad y estados OK |
| `--data-danger` | `#d9694f` | Bloqueos, playhead y errores |
| `--data-warn` | `#e8a93c` | Batería en reserva |

Reglas de contraste AA:

- `--text-0` y `--text-1` se usan para texto pequeño sobre `--bg-1`/`--bg-2`.
- `--text-2` queda para iconos, puntos, ticks y elementos decorativos.
- `--data-danger-ink` y `--data-horizon-ink` son variantes derivadas para texto pequeño; los tokens puros se reservan para gráficos, bordes y texto grande.

## Estructura

- `index.html`: shell de la aplicación (header, viewport, panel de controles, panel de estado, montajes de brújula y timeline, toast).
- `demo/main.ts`: orquestación entre `LunarEngine`, `BackendClient`, `LiveClock` y los widgets.
- `demo/ui/tokens.css`: tokens de color, tipografía, espaciado, radios, sombras, movimiento, z-index y breakpoints.
- `demo/ui/ui.css`: estilos del shell, panel, acordeones, controles, estado, brújula, timeline y responsive.
- `demo/ui/dom.ts`: helpers de DOM, formato UTC y anuncios accesibles.
- `demo/ui/icons.ts`: iconografía SVG en línea.
- `demo/ui/components/`: `Panel`, `AccordionSection`, `Select`, `SegmentedControl`, `Slider`, `Switch`, `Button`, `Badge`, `ProgressBar`, `Tooltip`, `InputField`.
- `demo/ui/compassMath.ts` y `demo/ui/CompassWidget.ts`: brújula HUD.
- `demo/ui/timelineMath.ts` y `demo/ui/TimelineWidget.ts`: línea de tiempo interactiva.
- `src/palette.ts`: colores de overlays y guías 3D, sincronizados con los tokens de datos.
- `tests/ui-math.test.ts`: pruebas de la matemática de brújula y timeline.

## Composición de la pantalla

- Header compacto con marca, sitio activo, badges de en vivo/DTE, rendimiento y toggles de panel.
- Panel izquierdo con acordeones: Sitio, Vista, Capas, Nuevo punto, Información.
- Panel de estado flotante a la derecha: co-visibilidad, Sol/Tierra, muestra horaria, cobertura, energía, ciencia y diagnóstico visual.
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

- Menos de 720 px: panel de controles como bottom sheet, panel de estado como overlay con botón de cierre, timeline simplificada y brújula reducida.
- Menos de 1100 px: panel y estado más estrechos.
- Se respeta `prefers-reduced-motion`.

## Verificación

```powershell
npx tsc -p tsconfig.demo.json --noEmit
npm run build
npm test
```

No hay un script `lint` configurado en este repositorio. El build incluye `tsc` y la compilación del demo.

Los colores 3D se limitan a overlays y guías: horizonte, rayo solar, enlace DTE, sky paths, marcadores científicos y LED de batería. No se modifican terreno, rampa de pendientes, iluminación, estrellas, Sol, bloom ni lens flare.

El build genera `dist-demo/`; el aviso de tamaño de chunk >500 kB es el mismo del build base y corresponde al bundle de Three.js.
