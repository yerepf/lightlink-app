# Lunar Co-Visibility — producto

Lunar Co-Visibility usa terreno del polo sur lunar y efemérides del Sol y la Tierra para explorar tres preguntas: dónde posar un módulo, cuánto tiempo tendrá luz y cuándo habrá línea de vista directa a la Tierra (DTE). La portada de Light&Link da acceso a dos modos que comparten la escena 3D y la línea de tiempo.

**Modo Explorador** enseña a interpretar esos datos mediante seis misiones guiadas en Site07. El recorrido parte de un alunizaje de riesgo y pide elegir un terreno más llano, encontrar una ventana de luz y señal, comprobar cuánto dura, reconocer las fuentes y comparar alternativas. La insignia final reconoce el aprendizaje.

**Mission Planner** permite explorar los sitios con todos los controles, evaluar una posición reubicada, inspeccionar resultados y comparar sitios o fechas en ventanas de igual duración. La hora UTC, el Sol, la Tierra/DTE y la batería simulada se consultan sobre la escena. Los análisis, la cobertura, los diagnósticos y las descargas se abren en **Detalles**.

La presentación del Planner mantiene el carácter de un instrumento científico: Inter, verdes apagados, líneas finas y paneles compactos. El modo guiado conserva la escena como centro de la experiencia y presenta instrucciones cerca del terreno sobre el que se actúa. La claridad de estados, unidades y procedencia tiene prioridad sobre la decoración.

## Contratos del producto

- Mostrar la procedencia de los datos y distinguir las series de la API, las copias incluidas, los cálculos de horizonte local y la demo simulada. Un valor ausente no es una medición.
- Las duraciones se estiman a partir de las muestras de visibilidad, sin interpolar estados booleanos. El modo en vivo depende de efemérides reales y cobertura para la hora actual.
- El análisis de una reubicación se limita al parche de elevación disponible. La visibilidad DTE es geométrica; la batería es simulada. El resultado no certifica una misión real.
- El registro de un punto mediante una API compatible no implica que estén listos sus datos. Mission Planner usa las cuentas del backend para guardar misiones e invitar colaboradores. La configuración guardada incluye los sitios y la ventana de análisis. El movimiento del lander y la descarga del análisis activo se procesan en el navegador.

[README_UI.md](README_UI.md) explica cómo usar y ejecutar ambos modos. [DESIGN.md](DESIGN.md) conserva el sistema visual del Planner.
