# PACMAD

Pacman in **real 3D** (Three.js) — low walls, floating pellets, infinite jump. Ready for **GitHub** and **Vercel**.

## Play locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

| Input | Action |
|--------|--------|
| Arrow keys / WASD | Move |
| Space | Jump over ghosts |
| Shift | Pause |
| Esc | Restart |
| Swipe (mobile) | Move |

## Deploy

Import the repo at [vercel.com/new](https://vercel.com/new) (output directory: `public`) or:

```bash
npx vercel --prod
```

## Stack

- **Three.js** (vendored in `public/vendor/`) — WebGL 3D
- **Express** — local static server
- Vercel serves `public/` as static output

## License

MIT
