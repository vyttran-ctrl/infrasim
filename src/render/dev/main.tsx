// Dev entry for the render playground. To use: create a temporary root html with <div id="root"> and
// <script type="module" src="/src/render/dev/main.tsx">, run `npx vite --port 5288`, then delete the html.
import { createRoot } from 'react-dom/client';
import { RenderPlayground } from './RenderPlayground';

createRoot(document.getElementById('root')!).render(<RenderPlayground />);
