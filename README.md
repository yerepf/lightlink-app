## Backend remoto

El frontend usa por defecto `https://backend.lightlink.club` mediante el proxy `/api`.

- `npm run dev`: abre Vite conectado al backend remoto; no requiere instalar ni ejecutar el backend local.
- `npm run dev:local`: inicia el backend local y lo conecta a Vite.
- `npm run preview`: sirve el build con el mismo proxy remoto.
- Puedes cambiar el destino con `BACKEND_URL` en el entorno o en `.env.local`. Reinicia Vite al cambiarlo.

El backend remoto no devuelve CORS para localhost. Por eso el navegador sigue solicitando `/api/sites` y `/api/assets/...`, y Vite hace la peticion HTTPS al servidor. En un despliegue estatico hay que configurar el mismo reverse proxy `/api` en el hosting; el proxy de Vite no se incluye en los archivos del build.

# Lunar Co-Visibility Explorer — motor 3D

Biblioteca TypeScript desacoplada de React. Acepta el contrato JSON solicitado sin añadir campos obligatorios. Requiere navegador con WebGL2, ResizeObserver y createImageBitmap.

```sh
npm install
npm run dev
npm run build
npm test
```

`npm run dev` inicia Vite y muestra la URL local en la terminal (normalmente http://localhost:5173). La página incluye un terreno sintético y un control de tiempo para probar el motor sin archivos del backend. No son datos científicos. `npm run build` compila la biblioteca en `dist/` y la demo en `dist-demo/`; `npm run preview` sirve la demo compilada. `npm run build:lib` compila únicamente la biblioteca. Configuración según la [guía de Vite](https://vite.dev/guide/).

```ts
import { LunarEngine } from './src/index';

const engine = new LunarEngine(document.querySelector<HTMLElement>('#viewport')!);
const response = await fetch('/assets/sites/Site01.json');
if (!response.ok) throw new Error(`Site HTTP ${response.status}`);
await engine.loadSite(await response.json());
engine.setTime(Date.parse('2026-11-14T00:00:00Z'));
// Opcional: una hora simulada por segundo real.
engine.play(3600);
engine.pause();
// Al desmontar:
engine.dispose();
```

El contenedor debe tener ancho y altura. Se puede pasar un canvas existente mediante `{ canvas }`; el motor sólo elimina el canvas que él mismo crea. `examples/LunarViewport.tsx` muestra montaje, cambio de sitio, slider temporal externo y limpieza compatible con StrictMode; copiarlo a una aplicación React + Vite. La demo utiliza TypeScript sin React; la biblioteca sigue desacoplada de la UI. Mantener estable la referencia de `site` evita recargas innecesarias.

## Convenciones científicas

- Unidades de escena: kilómetros; X este, Y arriba, −Z norte. Azimut horario desde norte. Elevación respecto al plano horizontal local. El centro del patch es el observador, situado en la altura interpolada del DEM, sin altura instrumental adicional.
- El PNG por defecto representa una altura normalizada lineal mediante el canal rojo de 8 bits: `z_m = min + red/255 * (max-min)`. Primera fila norte, primera columna oeste; no hay exageración vertical. No se infiere proyección, orientación ni datum a partir de la imagen. El backend debe garantizar estas convenciones.
- Para el intervalo del ejemplo, 8 bits producen pasos de aproximadamente 12.94 m. Para PNG de 16 bits/GeoTIFF, inyectar `decodeHeightmap(url, signal)` que devuelva `{ width, height, values: Float32Array }` normalizado a [0,1], preservando precisión. El decoder predeterminado de canvas no conserva 16 bits. Datos transparentes o valores no finitos se rechazan; no se inventan alturas para no-data.
- La malla usa 256 × 256 celdas por defecto (131072 triángulos), remuestreo bilineal y normales calculadas una vez. La superficie visual es una aproximación, no el modelo de oclusión del backend. No se calculan sombras topográficas, curvatura lunar ni oclusión por ray tracing.
- El Sol y la Tierra son indicadores de dirección a radio esquemático, sin escala astronómica. Las flechas se atenúan si la elevación interpolada no supera el horizonte. El horizonte violeta es una curva angular proyectada sobre una esfera, no una cresta física. Con máscaras parciales se interpola circularmente incluso sobre grandes huecos: suministrar una máscara completa para uso científico.
- `conditions` conserva exactamente la última muestra del backend; `sampleTimestampUtc` identifica su fecha. `horizonEstimate` es una estimación distinta a partir de direcciones interpoladas y horizonte lineal circular. No contempla disco solar/terrestre, refracción ni modelo adicional del backend; igualdad con el horizonte se considera ocultación.
- Interpolación temporal por arco corto en azimut y lineal en elevación. No es un propagador orbital: usar cadencia suficiente, particularmente cerca del cenit y de cruces del horizonte. Tiempos fuera del intervalo se limitan a los extremos; timestamps estrictamente crecientes y UTC con `Z`.

## Rendimiento y ciclo de vida

`setTime(ms)` busca la muestra en O(log N), actualiza transformaciones y luz, y reutiliza vectores y estado; no reconstruye la malla, no decodifica imágenes ni hace solicitudes de red. Su estado devuelto es prestado: usar `structuredClone` si se conserva; `getState()` devuelve una copia. No modificar el estado prestado.

El render usa un único bucle, OrbitControls con damping, DPR limitado a 1.5 y sin sombras dinámicas. Se omite renderizado con pestaña oculta o contenedor sin dimensiones. La reproducción pausa en los extremos y limita el salto tras bloqueos a 100 ms reales. `loadSite` aborta cargas anteriores, conserva la escena durante la carga y propaga errores. `dispose` cancela carga, observadores, controles, bucle y recursos GPU; es idempotente.

60 FPS es un objetivo, no una garantía universal. Consultar `engine.stats` (`fps`, `frameMs`, `drawCalls`, `triangles`) durante reproducción y movimiento orbital en el hardware objetivo; son métricas de cadencia del bucle, no tiempos GPU. Medir tras calentamiento durante al menos 30 segundos a resolución de producción. Si supera 16.7 ms/frame, probar `{ terrainSegments: 128, maxPixelRatio: 1 }`. La decodificación/construcción inicial sí consume CPU y no forma parte del camino de actualización temporal.

Las pruebas automatizadas cubren orientación, unidades, interpolación circular, extremos temporales, muestras únicas y validación. No sustituyen una verificación visual WebGL ni un benchmark en GPU real. El repositorio no incluye un DEM científico ni efemérides completas; el MP3 existente no se modifica.

Referencias de API: [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).
