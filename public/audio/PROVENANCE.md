# Explorer audio sources

- **lunar-orbit.mp3** comes from the HeyGen Music catalog. The source is Astral Generated Music, track ID `7c9d12c8b9f14e8a99a4bf0d7e64b964`. Encoded to MP3 with short fades at the loop boundary.
- **transmission.mp3** comes from the HeyGen sound-effects catalog. The source is Digital notification chime, track ID `fd8d6893299c363d`.
- **confirmed.mp3** comes from the HeyGen sound-effects catalog. The source is Ascending UI Chime, track ID `35aab3e8b2be2a98`.

## Astronaut narration

HeyGen Voice recorded the seven English passages in `demo/ui/ExplorerStoryMode.tsx` in one 71.684-second take. The tool used Wade – Resonant & Narrative (`a3a4aa242aaf431ea8ec2c4b3bb332fa`, `en-US`) with the workspace's default model and delivery settings. The script used the on-screen wording and separated passages with blank lines. HeyGen's returned character alignment matches that script. The browser plays the corresponding MP3 from `demo/audio/` and can use device speech synthesis if a clip fails to play.

| Clip | Start in source (seconds) | End in source (seconds) |
| --- | ---: | ---: |
| `astronaut-1.mp3` | 0.186 | 11.855 |
| `astronaut-2.mp3` | 11.779 | 20.764 |
| `astronaut-3.mp3` | 20.953 | 30.892 |
| `astronaut-4.mp3` | 30.995 | 43.846 |
| `astronaut-5.mp3` | 43.935 | 55.943 |
| `astronaut-6.mp3` | 56.034 | 65.403 |
| `astronaut-7.mp3` | 65.506 | 71.624 |
