export type Kind = 'city' | 'view' | 'hike' | 'ski' | 'park';

export interface Place { id: string; name: string; kind: Kind; lat: number; lon: number; note: string }

// Hand-picked spots in and around Brașov. Coordinates are approximate.
export const PLACES: Place[] = [
  { id: 'sfatului', name: 'Piața Sfatului', kind: 'city', lat: 45.6427, lon: 25.5887, note: 'Old town square, terraces' },
  { id: 'unirii', name: 'Piața Unirii · Șchei', kind: 'city', lat: 45.6362, lon: 25.5803, note: 'Șchei quarter under the forest' },
  { id: 'tampa', name: 'Tâmpa summit', kind: 'view', lat: 45.6359, lon: 25.5946, note: 'The hill above the old town' },
  { id: 'cetatuia', name: 'Cetățuia', kind: 'view', lat: 45.6497, lon: 25.5914, note: 'Citadel hill north of the centre' },
  { id: 'turnulalb', name: 'Turnul Alb', kind: 'view', lat: 45.6441, lon: 25.5861, note: 'White Tower viewpoint' },
  { id: 'belvedere', name: 'Belvedere', kind: 'view', lat: 45.6393, lon: 25.5722, note: 'Lookout on the Poiana road' },
  { id: 'solomon', name: 'Pietrele lui Solomon', kind: 'hike', lat: 45.6217, lon: 25.5633, note: 'Gorge and picnic meadow' },
  { id: 'noua', name: 'Lacul Noua', kind: 'park', lat: 45.6262, lon: 25.6368, note: 'Lake, zoo and adventure park' },
  { id: 'tractorul', name: 'Parcul Tractorul', kind: 'park', lat: 45.6676, lon: 25.5985, note: 'Flat northern part of the city' },
  { id: 'poiana', name: 'Poiana Brașov', kind: 'ski', lat: 45.5947, lon: 25.5553, note: 'Resort plateau at ~1000 m' },
  { id: 'postavaru', name: 'Vf. Postăvaru', kind: 'ski', lat: 45.5683, lon: 25.5664, note: 'Top of the ski area, 1799 m' },
  { id: 'piatramare', name: 'Cabana Piatra Mare', kind: 'hike', lat: 45.5622, lon: 25.6411, note: 'Hut below the Piatra Mare ridge' },
  { id: 'sapte', name: 'Canionul Șapte Scări', kind: 'hike', lat: 45.5700, lon: 25.6290, note: 'Seven Ladders canyon' },
  { id: 'rasnov', name: 'Cetatea Râșnov', kind: 'view', lat: 45.5906, lon: 25.4692, note: 'Hilltop fortress' },
  { id: 'lempes', name: 'Dealul Lempeș', kind: 'hike', lat: 45.7215, lon: 25.6330, note: 'Steppe hill above Sânpetru' },
];
