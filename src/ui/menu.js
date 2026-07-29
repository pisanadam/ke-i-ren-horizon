import { CARS } from '../vehicles/catalog.js';

/** Garage screen: pick a car, pick a colour, hit the road. */
export class Menu {
  constructor({ onSelect, onDrive, onColour }) {
    this.el = document.getElementById('menu');
    this.index = 0;
    this.colourIndex = 0;
    this.onSelect = onSelect;
    this.onDrive = onDrive;
    this.onColour = onColour;

    this.name = document.getElementById('car-name');
    this.klass = document.getElementById('car-class');
    this.desc = document.getElementById('car-desc');
    this.colourRow = document.getElementById('color-row');
    this.bars = {
      speed: document.getElementById('st-speed'),
      accel: document.getElementById('st-accel'),
      grip: document.getElementById('st-grip'),
      brake: document.getElementById('st-brake')
    };

    document.getElementById('car-prev').addEventListener('click', () => this.step(-1));
    document.getElementById('car-next').addEventListener('click', () => this.step(1));
    document.getElementById('btn-drive').addEventListener('click', () => this.onDrive());

    window.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.step(-1);
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.step(1);
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.onDrive(); }
    });
  }

  get car() {
    return CARS[this.index];
  }

  get colour() {
    return this.car.colours[this.colourIndex % this.car.colours.length];
  }

  step(dir) {
    this.index = (this.index + dir + CARS.length) % CARS.length;
    this.colourIndex = 0;
    this.render();
    this.onSelect(this.car, this.colour);
  }

  render() {
    const car = this.car;
    this.name.textContent = car.name;
    this.klass.textContent = car.class;
    this.desc.textContent = car.desc;
    for (const [key, el] of Object.entries(this.bars)) {
      el.style.width = `${Math.round((car.stats[key] ?? 0.5) * 100)}%`;
    }

    this.colourRow.innerHTML = '';
    car.colours.forEach((hex, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === this.colourIndex ? ' on' : '');
      b.style.background = `#${hex.toString(16).padStart(6, '0')}`;
      b.title = 'Renk seç';
      b.addEventListener('click', () => {
        this.colourIndex = i;
        this.render();
        this.onColour(this.colour);
      });
      this.colourRow.appendChild(b);
    });
  }

  show() {
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.el.classList.add('hidden');
  }

  get visible() {
    return !this.el.classList.contains('hidden');
  }
}
