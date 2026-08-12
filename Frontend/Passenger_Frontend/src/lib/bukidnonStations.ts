export type BukidnonStation = {
  id: string;
  label: string;
  city: string;
  latitude: number;
  longitude: number;
  description?: string;
};

export const BUKIDNON_STATIONS: BukidnonStation[] = [
  {
    id: "malaybalay-central-terminal",
    label: "Malaybalay Central Terminal",
    city: "Malaybalay",
    latitude: 8.1477,
    longitude: 125.1324,
    description: "Malaybalay City main bus terminal.",
  },
  {
    id: "valencia-bus-terminal",
    label: "Valencia Bus Terminal",
    city: "Valencia",
    latitude: 7.9039,
    longitude: 125.0991,
    description: "Valencia Integrated Bus Terminal.",
  },
  {
    id: "maramag-bus-terminal",
    label: "Maramag Bus Terminal",
    city: "Maramag",
    latitude: 7.7616,
    longitude: 125.0060,
    description: "Maramag town bus terminal.",
  },
  {
    id: "don-carlos-bus-terminal",
    label: "Don Carlos Bus Terminal",
    city: "Don Carlos",
    latitude: 7.6690,
    longitude: 125.1760,
    description: "Don Carlos terminal serving northern corridors.",
  },
];
