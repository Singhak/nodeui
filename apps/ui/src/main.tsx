import { createRoot } from 'react-dom/client';
import App from './App';
import { initTheme } from './theme';
import './styles.css';

initTheme();
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
