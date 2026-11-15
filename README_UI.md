# Interfaz de Lunar Co-Visibility

Desde la portada ilustrada de Light&Link, pulsa **Iniciar** para elegir entre **Modo Explorador** (`#explorador`) y **Mission Planner** (`#mision`). Puedes abrir cualquiera de los modos por su enlace directo o cambiar de uno a otro desde la cabecera. **Reiniciar** vuelve al inicio de las seis misiones. El menú conserva su arte y su astronauta; la animación se detiene si el sistema solicita reducir el movimiento.

## Modo Explorador

El recorrido carga la copia local de `Site07`, en el polo sur lunar. La historia se integra en la esquina inferior derecha de la escena 3D y propone seis misiones:

1. **¿Dónde estamos?** Orienta la cámara o pulsa **Entendido, ¡empecemos!** para comenzar.
2. **Alunizaje en peligro.** Activa el reubicador y selecciona un vértice verde (pendiente menor de 10°). El recorrido no avanza con una pendiente de riesgo.
3. **Luz y señal.** Busca en la línea de tiempo una muestra en la que el Sol y la Tierra sean visibles a la vez. Si el lugar elegido no tiene ninguna en la cobertura disponible, vuelve al mapa y escoge otro punto verde.
4. **¿Cuánto dura la misión?** Responde si la ventana satisface el requisito de ocho horas seguidas de luz y señal. La autonomía en sombra es una estimación de la batería simulada.
5. **De dónde salen los datos.** Consulta el papel del altímetro LOLA para el relieve y de JPL Horizons para las efemérides.
6. **Compara antes de aterrizar.** Completa una comparación válida, cierra el diálogo y recoge la insignia. La insignia reconoce el recorrido educativo y no certifica la planificación de vuelo.

## Mission Planner

La escena conserva el HUD con hora UTC, Sol, Tierra/DTE y batería simulada. El panel de controles reúne **Sitio**, **Vista**, **Capas**, **Nuevo punto** e **Información**. En **Detalles** puedes ver los resultados, la cobertura, la energía, el gráfico de elevaciones frente al horizonte y las descargas **CSV** y **JSON**. Las descargas se generan en el navegador para el análisis activo, incluida la reubicación si corresponde. El CSV enumera las ventanas; el JSON incluye además las horas acumuladas, la máscara del horizonte y las muestras de la línea de tiempo.

- **Reubicar:** en **Sitio**, pulsa **Activar reubicador** y haz clic o toca un vértice del mapa. Con el teclado, mueve el cursor con las flechas, confirma con **Enter** o **Espacio** y cancela con **Escape**. El mapa distingue pendiente verde (< 10°), intermedia (10°–15°) y roja (> 15°). El Planner permite evaluar también posiciones de riesgo.
- **Comparar:** abre **Comparar** en la cabecera. Selecciona las dos opciones, incluida la posición activa o reubicada. Por defecto ambas se evalúan en el mismo intervalo UTC de cobertura común. Con **Elegir dos fechas UTC**, indica un inicio por opción y una duración común que quepa en ambas coberturas. El diálogo muestra las horas de Sol, Tierra/DTE y co-visibilidad, el porcentaje de terreno con pendiente menor de 10° y la procedencia de cada serie. La recomendación se basa en las horas de co-visibilidad y se omite si solo una de las series es simulada.
- **Recorrer el tiempo:** arrastra el cabezal o usa las flechas para avanzar por muestras (`Shift` multiplica el salto por diez); **Home** y **End** llevan a los extremos. Hay controles de reproducción, bucle y velocidad, y se puede ampliar con la rueda o con `+` y `-`. El modo en vivo requiere efemérides reales y cobertura para la hora actual.

La brújula muestra el norte verdadero corregido por convergencia de cuadrícula en las vistas de superficie y órbita, y fija el norte arriba en vista de mapa. Los paneles nuevos combinan superficies oscuras translúcidas y acentos verdes con las fuentes existentes. El Planner conserva su distribución densa; en pantallas estrechas los controles pasan a la parte inferior, los detalles se abren sobre la escena y el comparador se adapta al ancho disponible. El sistema visual del Planner se documenta en [DESIGN.md](DESIGN.md).

## Datos, ejecución y límites

Para ejecutar el demo en desarrollo, instala las dependencias con `npm ci` y arranca Vite con `npm run dev:frontend`. `npm run build` genera `dist-demo/`. Para usarlo sin una API remota, sirve esa carpeta desde un servidor HTTP local o estático; abrir `index.html` directamente desde disco no sirve los recursos que la app solicita. La API es opcional: el cliente usa `VITE_API_URL` si se configura al compilar y, si no, usa `/api`. En Vite, `BACKEND_URL` define el destino del proxy de `/api`.

El paquete incluye datos de `Site01` y `Site07` para alturas de observación de 2 y 5 m, con los mapas de elevación originales de 16 bits y las series del backend en el commit `22489b4d12a34eced448dfede9e72986fdf70908`. Las copias locales conservan la cobertura incluida; no generan efemérides ni amplían fechas. Para regenerarlas desde la raíz, con el repositorio del backend disponible en `backend/`, ejecuta `node --import tsx scripts/prepare-offline.ts`.

La reubicación toma la pendiente de la malla sin exageración vertical y recalcula un horizonte de 360 rayos sobre el modelo digital de elevación (DEM) original. Usa los ángulos base de JPL Horizons y no intenta representar relieve fuera del parche. El cálculo cuesta `O(360 × muestras por rayo + muestras temporales)`; consultar una elevación en el horizonte regular cuesta `O(1)`. Para medir horas, cada estado booleano se mantiene hasta la próxima muestra, sin interpolarlo ni sumar tiempo después de la última. El porcentaje por pendiente estima el área en la cuadrícula del parche DEM, sin contar su borde exterior.

DTE representa línea de vista geométrica, sin predecir el rendimiento de un enlace. Este demo no certifica alunizajes ni operaciones de vuelo. No hay autenticación, gestión de equipos ni guardado de escenarios en la revisión examinada. **Nuevo punto** requiere un backend que acepte `POST /sites`; el backend local requiere Redis para el registro y puede devolver `pending_data` mientras el sitio carezca de máscara, efemérides y mapa de elevación específicos.

## Archivos y comprobaciones

- `index.html` y `demo/start.ts`: portada, selector de modos, navegación por fragmento y carga inicial de la escena.
- `demo/main.ts` y `demo/apiClient.ts`: coordinación de la escena, los controles y la procedencia de los datos.
- `demo/ui/ExplorerStoryMode.tsx`, `SiteComparator.tsx`, `MissionAnalysis.ts` y `flight.css`: recorrido, comparación, análisis y estilos de las nuevas superficies.
- `src/relocation.ts` y `src/missionMetrics.ts`: horizonte a partir del DEM y métricas temporales.

`npm test` ejecuta las pruebas del repositorio; `npm run build` comprueba TypeScript y compila el demo. No hay un script `lint` configurado.
