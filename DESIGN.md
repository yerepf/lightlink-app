---
name: Lunar Co-Visibility Mission Workspace
description: Instrumentación lunar sobria, legible y orientada a planificación técnica.
colors:
  background: "#101710"
  panel: "#172017"
  surface: "#202b20"
  surface-raised: "#2b382a"
  primary: "#bdcaaa"
  text: "#edf0e7"
  text-secondary: "#bec8b8"
  text-muted: "#91a08b"
  hairline: "#85977b55"
  hairline-soft: "#85977b33"
  sun: "#e8a93c"
  earth: "#7fb0c4"
  horizon: "#a893c0"
  ok: "#a8b99a"
  danger: "#d9694f"
typography:
  title:
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 450
    lineHeight: 1.5
  label:
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
  annotation:
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "11px"
rounded:
  sm: "2px"
  md: "2px"
  lg: "0px"
  xl: "0px"
  pill: "2px"
spacing:
  one: "4px"
  two: "8px"
  three: "12px"
  four: "16px"
  five: "20px"
  six: "24px"
  eight: "32px"
  ten: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
---

# Design System: Lunar Co-Visibility

## Overview

La dirección aprobada es un espacio técnico de planificación de misión. Su carácter es sobrio, científico y preciso: instrumentación visible sobre el terreno, controles planos y resultados detallados bajo demanda. No se ha confirmado una metáfora creativa adicional.

Características principales: verde apagado, Inter, líneas finas, densidad funcional y esquinas mínimas.

Esta captura describe la implementación vigente. `demo/main.ts` carga `tokens.css`, después `ui.css` y finalmente `mission.css`. Los valores efectivos de esta cabecera incluyen las sustituciones de `mission.css`; no copiar la paleta crema ni las sombras históricas de `tokens.css` como si fueran el resultado actual. Los colores científicos de datos permanecen en `tokens.css` y `src/palette.ts`.

## Colors

El acento primario es un verde claro apagado; las superficies forman una escala de verdes oscuros. Texto principal, secundario y atenuado separan niveles de información sin introducir nuevos acentos.

Sol, Tierra, horizonte, estados correctos y peligro conservan colores semánticos distintos para datos científicos. Sus nombres y valores están en la cabecera. No usar estos colores como decoración intercambiable.

Los alias `--bg-0`, `--bg-2`, `--text-0` y `--ui-accent` resuelven a las primitivas actuales. Algunas mezclas y valores de base heredados siguen existiendo, por ejemplo `--ui-accent-soft`; esta documentación no afirma que toda la hoja histórica haya sido sustituida.

## Typography

Inter es la familia principal, con alternativas del sistema. Se sirve localmente desde `public/fonts/InterVariable.woff2`; la licencia está en `public/fonts/Inter-LICENSE.txt`. La fuente procede del repositorio oficial `rsms/inter`, ruta `docs/font-files/InterVariable.woff2` en la rama `master`; la licencia procede de `LICENSE.txt`. La rama es mutable: no se ha registrado aquí una revisión inmutable.

El título de aplicación usa la jerarquía title; las etiquetas usan label y las notas annotation. La hora UTC y los valores del HUD usan cifras tabulares. El HUD muestra valores de 14 px en escritorio y 13 px en móvil. La interfaz no necesita titulares promocionales grandes.

## Layout

En escritorio, cabecera de 58 px, controles izquierdos de 284 px, detalles de 320 px y timeline de 174 px. El HUD queda a 24 px del borde de escena y sigue el desplazamiento del panel. La brújula ocupa la zona inferior izquierda de la escena.

Hasta 1100 px, los paneles pasan a 260 y 300 px. Hasta 720 px, la cabecera mide 56 px, el HUD tiene dos columnas y el timeline 210 px; los controles conservan el comportamiento de panel inferior. Las velocidades y la lectura temporal tienen filas propias. Los detalles son un overlay cerrable. En móvil, los botones «Detalles» y «Controles» conservan etiquetas visibles de 10 px bajo iconos de 16 px, en botones de 56 px de ancho, para distinguir sus funciones.

## Elevation & Depth

Los paneles y el timeline son planos: las sombras estructurales se sustituyen por `none` y no usan desenfoque de fondo. Los límites se comunican con tono y líneas finas. El texto del HUD y la brújula mantienen sombras oscuras para legibilidad sobre terreno, sin crear tarjetas flotantes. El foco de teclado conserva su tratamiento visible.

## Shapes

Las superficies grandes son rectangulares. Los controles usan radios mínimos de 2 px; el pulgar del interruptor usa 1 px. Las bandas del timeline son rectas. Evitar convertir estados en una colección de píldoras o tarjetas redondeadas.

## Components

Los botones conservan variantes primaria, secundaria, fantasma y peligro. La altura mínima habitual es 40 px; la variante pequeña usa 32 px. Hover cambia superficie o borde, active desplaza 1 px y disabled reduce opacidad. Conservar foco visible y etiquetas accesibles.

Los acordeones son secciones abiertas visualmente, separadas por una línea inferior. Su disparador tiene altura mínima de 48 px. Los selectores segmentados usan una selección tenue con borde, y los interruptores siguen líneas divisorias.

El HUD presenta UTC, Sol, Tierra/DTE y batería simulada sin caja opaca. No captura eventos del puntero; las acciones permanecen en los controles existentes. «Detalles» abre el panel de estado, cerrado al iniciar la aplicación. No confundir ese panel con un futuro modo Explorer.

El timeline y la brújula conservan sus interacciones científicas y navegación por teclado. El sistema respeta `prefers-reduced-motion` mediante duraciones de transición nulas.

## Do's and Don'ts

- Do conservar etiquetas, unidades, estado de simulación y procedencia científica.
- Do usar las primitivas efectivas y revisar la cascada antes de extender un componente.
- Do mantener los indicadores esenciales legibles sobre el terreno y los detalles disponibles bajo demanda.
- Don't restaurar las tarjetas redondeadas, desenfoques y sombras del estilo anterior.
- Don't anunciar un modo Explorer implementado ni inventar controles que no existen.
