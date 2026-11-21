# Skies Weather

A web app modelled on the iPhone Weather app.

- **Opens on your current location** (browser geolocation; falls back to Cupertino if you don't allow it)
- **Change location**: tap ☰ → search any city → it's saved to your list. Swipe left/right or tap the dots to move between cities; tap ✕ on a card to remove it.
- **Animated backdrops** that match the weather: sun with rays, a starry night with moon, drifting clouds, rain with splashes, thunderstorms with lightning, snow, fog, and wind streaks with blowing leaves.
- **Hourly forecast** for the next 24 hours, including sunrise and sunset.
- **10-day / 30-day forecast** switch. Days 1–16 come from the main forecast; days 17–30 are an extended outlook averaged across GFS ensemble runs.
- Detail tiles: UV index, sunrise/sunset, wind compass, feels like, precipitation, humidity, visibility, pressure.
- °C / °F toggle (bottom left).

Weather data from [Open-Meteo](https://open-meteo.com/); no API key needed.

## Run it

Geolocation only works over `https://` or `localhost`, so serve the folder:

```sh
cd weather-app
python3 -m http.server 8000
# open http://localhost:8000
```

Or host the folder on GitHub Pages.

To preview a backdrop without waiting for that weather, add `?scene=` with one of
`clear | partly | cloud | fog | drizzle | rain | heavy | snow | storm`. You can also add `&night=1` and/or `&wind=1`,
e.g. `index.html?scene=storm&night=1`.
