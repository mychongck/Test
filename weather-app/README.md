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

## Run it on your computer

### 1. Download the app

1. Download the zip: <https://github.com/mychongck/Test/archive/refs/heads/claude/weather-app-forecast-jvyv2b.zip>
   (sign in to GitHub first if the repo is private).
2. Unzip it and open the `weather-app` folder inside.

### 2. Start it

**If you have Python** (recommended, because the app can then ask for your location):

- **Windows:** in the `weather-app` folder, click the address bar, type `cmd` and press Enter. Then run:

  ```sh
  python -m http.server 8000
  ```

- **Mac:** open Terminal, type `cd ` (with a space), drag the `weather-app` folder into the window, press Enter, then run:

  ```sh
  python3 -m http.server 8000
  ```

Then open <http://localhost:8000> in Chrome, Edge or Safari and click **Allow** when it asks for your location.
Leave the command window open while you use the app.

**If you don't have Python:** double-click `index.html`. The app works the same way, but your browser may not let a
file opened like this ask for your location. If so, it shows Cupertino; tap ☰ at the bottom right to search for your city.

### 3. Use it

| Control | What it does |
| --- | --- |
| ☰ (bottom right) | Search for and add cities |
| Swipe, or tap the dots | Move between your saved cities |
| °C (bottom left) | Switch between °C and °F |
| 10 Days / 30 Days | Switch the forecast length |

## Run it on your phone (GitHub Pages)

1. In the GitHub repo, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, pick this branch (or `main` once merged) and **/ (root)**, then **Save**.
3. After a minute, open <https://mychongck.github.io/Test/weather-app/> in Safari.
4. Tap **Share → Add to Home Screen** to open it full-screen like an app.

## Preview a backdrop

To see a backdrop without waiting for that weather, add `?scene=` with one of
`clear | partly | cloud | fog | drizzle | rain | heavy | snow | storm`. You can also add `&night=1` and/or `&wind=1`,
e.g. `index.html?scene=storm&night=1`.
