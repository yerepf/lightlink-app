# Lunar Co-Visibility — producto

La experiencia actual es un espacio técnico para planificar y revisar condiciones de una misión lunar: explorar el terreno, consultar visibilidad del Sol y enlace directo con la Tierra, recorrer muestras temporales y revisar energía simulada.

La escena conserva el protagonismo. La hora UTC, el Sol, la Tierra/DTE y la batería simulada se consultan directamente sobre ella. Los controles de sitio, vista, capas y puntos permanecen disponibles; resultados, cobertura, energía y diagnósticos se abren bajo demanda con «Detalles».

La presentación debe ser sobria y científica: Inter, verdes apagados, líneas finas y formas casi rectangulares. La claridad de estados, unidades y procedencia de los datos pesa más que la decoración.

Un modo Explorer separado es una dirección futura aprobada, no una función implementada ni un selector disponible. No presentar el espacio técnico actual como una experiencia divulgativa terminada.

## Contratos que se conservan

- Los estados de visibilidad corresponden a muestras del backend; no interpolar booleanos para aparentar mayor precisión.
- Diferenciar batería simulada, demo y datos reales. No convertir un valor ausente en una medición válida.
- Conservar el motor científico, la física, los controles reales y sus contratos de datos.
- El modo en vivo depende de efemérides reales y cobertura para la hora actual.

La documentación visual normativa está en `DESIGN.md`; la estructura de implementación y las comprobaciones están en `README_UI.md`.
