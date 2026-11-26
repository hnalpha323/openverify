/** `cytoscape-fcose` 2.2.0 ships no types: it is a Cytoscape.js extension registered with `use`. */
declare module 'cytoscape-fcose' {
  import type { Ext } from 'cytoscape';

  const fcose: Ext;
  export default fcose;
}
