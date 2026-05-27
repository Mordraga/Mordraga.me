export const state = {
  name: '', subtitle: '', url: '', footer: '',
  swGreen: '', swYellow: '', swRed: '',
  roles: new Set(), customRoles: [],
  subItems: [], domItems: [], bothItems: [], hardLimits: [],
  note: '', dm: ''
};

const subs = new Set();
export const subscribe = fn => subs.add(fn);
export const notify    = ()  => subs.forEach(fn => fn(state));
