export type Kind = 'city' | 'view' | 'hike' | 'ski' | 'park';

export interface Place { id: string; name: string; kind: Kind; lat: number; lon: number; note: string }

// Hand-picked spots in and around Brașov. City coordinates come from OpenStreetMap/Overture
// names; the mountain ones are approximate.
export const PLACES: Place[] = [
  { id: 'sfatului', name: 'Piața Sfatului', kind: 'city', lat: 45.6423, lon: 25.5893, note: 'Old town square, terraces' },
  { id: 'republicii', name: 'Strada Republicii', kind: 'city', lat: 45.6439, lon: 25.5918, note: 'Pedestrian street, cafés' },
  { id: 'unirii', name: 'Piața Unirii · Șchei', kind: 'city', lat: 45.6357, lon: 25.5803, note: 'Șchei quarter under the forest' },
  { id: 'ecaterinei', name: 'Poarta Ecaterinei', kind: 'city', lat: 45.6397, lon: 25.5857, note: 'Medieval gate at the edge of Șchei' },
  { id: 'ziduri', name: 'După Ziduri', kind: 'park', lat: 45.6404, lon: 25.5853, note: 'Stream-side walk behind the walls' },
  { id: 'subtampa', name: 'Aleea de sub Tâmpa', kind: 'park', lat: 45.6396, lon: 25.5940, note: 'Promenade at the foot of Tâmpa' },
  { id: 'titulescu', name: 'Parcul Titulescu', kind: 'park', lat: 45.6461, lon: 25.5915, note: 'Central park' },
  { id: 'tesatorilor', name: 'Bastionul Țesătorilor', kind: 'city', lat: 45.6372, lon: 25.5885, note: 'Weavers\' Bastion' },
  { id: 'turnulalb', name: 'Turnul Alb', kind: 'view', lat: 45.6429, lon: 25.5865, note: 'White Tower viewpoint' },
  { id: 'turnulnegru', name: 'Turnul Negru', kind: 'view', lat: 45.6413, lon: 25.5856, note: 'Black Tower viewpoint' },
  { id: 'tampa', name: 'Tâmpa summit', kind: 'view', lat: 45.6342, lon: 25.5929, note: 'The hill above the old town' },
  { id: 'cetatuia', name: 'Cetățuia', kind: 'view', lat: 45.6497, lon: 25.5914, note: 'Citadel hill north of the centre' },
  { id: 'warthe', name: 'Dealul Warthe', kind: 'view', lat: 45.6468, lon: 25.5758, note: 'Hill west of the old town' },
  { id: 'belvedere', name: 'Belvedere', kind: 'view', lat: 45.6393, lon: 25.5722, note: 'Lookout on the Poiana road' },
  { id: 'tractorul', name: 'Parcul Tractorul', kind: 'park', lat: 45.6676, lon: 25.5985, note: 'Flat northern part of the city' },
  { id: 'coresi', name: 'Coresi', kind: 'city', lat: 45.6722, lon: 25.6150, note: 'New quarter and shopping area' },
  { id: 'solomon', name: 'Pietrele lui Solomon', kind: 'hike', lat: 45.6217, lon: 25.5633, note: 'Gorge and picnic meadow' },
  { id: 'noua', name: 'Lacul Noua', kind: 'park', lat: 45.6136, lon: 25.6397, note: 'Lake, zoo and adventure park' },
  { id: 'poiana', name: 'Poiana Brașov', kind: 'ski', lat: 45.5947, lon: 25.5553, note: 'Resort plateau at ~1000 m' },
  { id: 'postavaru', name: 'Vf. Postăvaru', kind: 'ski', lat: 45.5683, lon: 25.5664, note: 'Top of the ski area, 1799 m' },
  { id: 'piatramare', name: 'Cabana Piatra Mare', kind: 'hike', lat: 45.5622, lon: 25.6411, note: 'Hut below the Piatra Mare ridge' },
  { id: 'sapte', name: 'Canionul Șapte Scări', kind: 'hike', lat: 45.5700, lon: 25.6290, note: 'Seven Ladders canyon' },
  { id: 'rasnov', name: 'Cetatea Râșnov', kind: 'view', lat: 45.5906, lon: 25.4692, note: 'Hilltop fortress' },
  { id: 'lempes', name: 'Dealul Lempeș', kind: 'hike', lat: 45.7215, lon: 25.6330, note: 'Steppe hill above Sânpetru' },
];
