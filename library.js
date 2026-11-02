// Built-in exercise library and starter plans. Ships with the app (works offline, no server).
// e = equipment codes: B Barbell, D Dumbbell, M Machine, C Cable, W Bodyweight, K Kettlebell, S Smith machine, E EZ bar
export const EQ = {"B": "Barbell", "D": "Dumbbell", "M": "Machine", "C": "Cable", "W": "Bodyweight", "K": "Kettlebell", "S": "Smith", "E": "EZ bar"};
export const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings & glutes", "Calves", "Core", "Full body & conditioning"];
export const LIB = [{"n": "Bench press", "m": "Chest", "e": "BDSM"}, {"n": "Incline bench press", "m": "Chest", "e": "BDS"}, {"n": "Decline bench press", "m": "Chest", "e": "BD"}, {"n": "Chest press", "m": "Chest", "e": "M"}, {"n": "Incline chest press", "m": "Chest", "e": "M"}, {"n": "Chest fly", "m": "Chest", "e": "DC"}, {"n": "Pec deck", "m": "Chest", "e": "M"}, {"n": "Cable crossover", "m": "Chest", "e": "C"}, {"n": "Low-to-high cable fly", "m": "Chest", "e": "C"}, {"n": "Push-up", "m": "Chest", "e": "W"}, {"n": "Dips (chest)", "m": "Chest", "e": "WM"}, {"n": "Floor press", "m": "Chest", "e": "BD"}, {"n": "Svend press", "m": "Chest", "e": "W"}, {"n": "Landmine press", "m": "Chest", "e": "B"}, {"n": "Close-grip push-up", "m": "Chest", "e": "W"}, {"n": "Pullover", "m": "Chest", "e": "DC"}, {"n": "Lat pulldown", "m": "Back", "e": "CM"}, {"n": "Close-grip pulldown", "m": "Back", "e": "C"}, {"n": "Neutral-grip pulldown", "m": "Back", "e": "C"}, {"n": "Straight-arm pulldown", "m": "Back", "e": "C"}, {"n": "Pull-up", "m": "Back", "e": "WM"}, {"n": "Chin-up", "m": "Back", "e": "WM"}, {"n": "Seated cable row", "m": "Back", "e": "CM"}, {"n": "Bent-over row", "m": "Back", "e": "BD"}, {"n": "One-arm dumbbell row", "m": "Back", "e": "D"}, {"n": "T-bar row", "m": "Back", "e": "BM"}, {"n": "Chest-supported row", "m": "Back", "e": "DM"}, {"n": "Pendlay row", "m": "Back", "e": "B"}, {"n": "Machine row", "m": "Back", "e": "M"}, {"n": "Inverted row", "m": "Back", "e": "W"}, {"n": "Deadlift", "m": "Back", "e": "B"}, {"n": "Rack pull", "m": "Back", "e": "B"}, {"n": "Back extension", "m": "Back", "e": "WM"}, {"n": "Good morning", "m": "Back", "e": "B"}, {"n": "Shrug", "m": "Back", "e": "BDM"}, {"n": "Face pull", "m": "Back", "e": "C"}, {"n": "Reverse fly", "m": "Back", "e": "DCM"}, {"n": "Meadows row", "m": "Back", "e": "B"}, {"n": "Shoulder press", "m": "Shoulders", "e": "BDM"}, {"n": "Overhead press (standing)", "m": "Shoulders", "e": "BD"}, {"n": "Arnold press", "m": "Shoulders", "e": "D"}, {"n": "Lateral raise", "m": "Shoulders", "e": "DCM"}, {"n": "Front raise", "m": "Shoulders", "e": "DCB"}, {"n": "Rear delt fly", "m": "Shoulders", "e": "DCM"}, {"n": "Upright row", "m": "Shoulders", "e": "BCD"}, {"n": "Cable Y-raise", "m": "Shoulders", "e": "C"}, {"n": "Lu raise", "m": "Shoulders", "e": "D"}, {"n": "Push press", "m": "Shoulders", "e": "B"}, {"n": "Landmine shoulder press", "m": "Shoulders", "e": "B"}, {"n": "Machine lateral raise", "m": "Shoulders", "e": "M"}, {"n": "Behind-the-neck press", "m": "Shoulders", "e": "B"}, {"n": "Bradford press", "m": "Shoulders", "e": "B"}, {"n": "Plate front raise", "m": "Shoulders", "e": "W"}, {"n": "External rotation", "m": "Shoulders", "e": "CD"}, {"n": "Biceps curl", "m": "Biceps", "e": "BDCE"}, {"n": "Hammer curl", "m": "Biceps", "e": "DC"}, {"n": "Preacher curl", "m": "Biceps", "e": "DEM"}, {"n": "Incline dumbbell curl", "m": "Biceps", "e": "D"}, {"n": "Concentration curl", "m": "Biceps", "e": "D"}, {"n": "Cable curl", "m": "Biceps", "e": "C"}, {"n": "Spider curl", "m": "Biceps", "e": "DE"}, {"n": "Reverse curl", "m": "Biceps", "e": "BE"}, {"n": "Bayesian curl", "m": "Biceps", "e": "C"}, {"n": "Drag curl", "m": "Biceps", "e": "B"}, {"n": "Triceps pushdown", "m": "Triceps", "e": "C"}, {"n": "Rope pushdown", "m": "Triceps", "e": "C"}, {"n": "Overhead triceps extension", "m": "Triceps", "e": "DC"}, {"n": "Skull crusher", "m": "Triceps", "e": "BDE"}, {"n": "Close-grip bench press", "m": "Triceps", "e": "BS"}, {"n": "Dips (triceps)", "m": "Triceps", "e": "WM"}, {"n": "Triceps kickback", "m": "Triceps", "e": "DC"}, {"n": "Single-arm cable extension", "m": "Triceps", "e": "C"}, {"n": "JM press", "m": "Triceps", "e": "BS"}, {"n": "Diamond push-up", "m": "Triceps", "e": "W"}, {"n": "Squat", "m": "Quads", "e": "BS"}, {"n": "Front squat", "m": "Quads", "e": "B"}, {"n": "Hack squat", "m": "Quads", "e": "M"}, {"n": "Leg press", "m": "Quads", "e": "M"}, {"n": "Goblet squat", "m": "Quads", "e": "DK"}, {"n": "Bulgarian split squat", "m": "Quads", "e": "DBS"}, {"n": "Lunge", "m": "Quads", "e": "DBW"}, {"n": "Walking lunge", "m": "Quads", "e": "DW"}, {"n": "Step-up", "m": "Quads", "e": "DW"}, {"n": "Leg extension", "m": "Quads", "e": "M"}, {"n": "Pendulum squat", "m": "Quads", "e": "M"}, {"n": "Belt squat", "m": "Quads", "e": "M"}, {"n": "Sissy squat", "m": "Quads", "e": "WM"}, {"n": "Wall sit", "m": "Quads", "e": "W"}, {"n": "Romanian deadlift", "m": "Hamstrings & glutes", "e": "BD"}, {"n": "Stiff-leg deadlift", "m": "Hamstrings & glutes", "e": "BD"}, {"n": "Lying leg curl", "m": "Hamstrings & glutes", "e": "M"}, {"n": "Seated leg curl", "m": "Hamstrings & glutes", "e": "M"}, {"n": "Nordic curl", "m": "Hamstrings & glutes", "e": "W"}, {"n": "Hip thrust", "m": "Hamstrings & glutes", "e": "BM"}, {"n": "Glute bridge", "m": "Hamstrings & glutes", "e": "BW"}, {"n": "Cable kickback", "m": "Hamstrings & glutes", "e": "C"}, {"n": "Hip abduction", "m": "Hamstrings & glutes", "e": "MC"}, {"n": "Hip adduction", "m": "Hamstrings & glutes", "e": "MC"}, {"n": "Sumo deadlift", "m": "Hamstrings & glutes", "e": "B"}, {"n": "Kettlebell swing", "m": "Hamstrings & glutes", "e": "K"}, {"n": "Single-leg RDL", "m": "Hamstrings & glutes", "e": "DK"}, {"n": "Reverse hyperextension", "m": "Hamstrings & glutes", "e": "M"}, {"n": "Standing calf raise", "m": "Calves", "e": "MSD"}, {"n": "Seated calf raise", "m": "Calves", "e": "M"}, {"n": "Calf press (leg press)", "m": "Calves", "e": "M"}, {"n": "Single-leg calf raise", "m": "Calves", "e": "DW"}, {"n": "Plank", "m": "Core", "e": "W"}, {"n": "Side plank", "m": "Core", "e": "W"}, {"n": "Crunch", "m": "Core", "e": "WM"}, {"n": "Cable crunch", "m": "Core", "e": "C"}, {"n": "Hanging leg raise", "m": "Core", "e": "W"}, {"n": "Hanging knee raise", "m": "Core", "e": "W"}, {"n": "Lying leg raise", "m": "Core", "e": "W"}, {"n": "Ab wheel rollout", "m": "Core", "e": "W"}, {"n": "Russian twist", "m": "Core", "e": "WD"}, {"n": "Pallof press", "m": "Core", "e": "C"}, {"n": "Dead bug", "m": "Core", "e": "W"}, {"n": "Bicycle crunch", "m": "Core", "e": "W"}, {"n": "Woodchopper", "m": "Core", "e": "C"}, {"n": "Decline sit-up", "m": "Core", "e": "W"}, {"n": "Clean", "m": "Full body & conditioning", "e": "B"}, {"n": "Power clean", "m": "Full body & conditioning", "e": "B"}, {"n": "Snatch", "m": "Full body & conditioning", "e": "B"}, {"n": "Thruster", "m": "Full body & conditioning", "e": "BD"}, {"n": "Farmer's carry", "m": "Full body & conditioning", "e": "DK"}, {"n": "Burpee", "m": "Full body & conditioning", "e": "W"}, {"n": "Sled push", "m": "Full body & conditioning", "e": "M"}, {"n": "Battle ropes", "m": "Full body & conditioning", "e": "W"}, {"n": "Rowing machine", "m": "Full body & conditioning", "e": "M"}, {"n": "Treadmill", "m": "Full body & conditioning", "e": "M"}, {"n": "Bike", "m": "Full body & conditioning", "e": "M"}, {"n": "Stair climber", "m": "Full body & conditioning", "e": "M"}];
export const PLANS = [
 {
  "id": "ppl",
  "name": "Push / Pull / Legs",
  "who": "The classic. Great from 3 to 6 days a week.",
  "target": 3,
  "days": {
   "Push": [
    "Bench press",
    "Incline bench press",
    "Shoulder press",
    "Lateral raise",
    "Triceps pushdown",
    "Overhead triceps extension"
   ],
   "Pull": [
    "Lat pulldown",
    "Seated cable row",
    "One-arm dumbbell row",
    "Face pull",
    "Biceps curl",
    "Hammer curl"
   ],
   "Legs": [
    "Squat",
    "Romanian deadlift",
    "Leg press",
    "Lying leg curl",
    "Leg extension",
    "Standing calf raise"
   ]
  }
 },
 {
  "id": "ul",
  "name": "Upper / Lower",
  "who": "Balanced and time-efficient. Ideal for 4 days a week.",
  "target": 4,
  "days": {
   "Upper": [
    "Bench press",
    "Lat pulldown",
    "Shoulder press",
    "Seated cable row",
    "Biceps curl",
    "Triceps pushdown"
   ],
   "Lower": [
    "Squat",
    "Romanian deadlift",
    "Leg press",
    "Lying leg curl",
    "Standing calf raise",
    "Plank"
   ]
  }
 },
 {
  "id": "fb",
  "name": "Full body",
  "who": "Best for beginners or busy weeks. 2–3 days a week.",
  "target": 3,
  "days": {
   "Full body A": [
    "Squat",
    "Bench press",
    "Seated cable row",
    "Shoulder press",
    "Plank"
   ],
   "Full body B": [
    "Deadlift",
    "Incline bench press",
    "Lat pulldown",
    "Lunge",
    "Biceps curl"
   ]
  }
 },
 {
  "id": "bro",
  "name": "Body-part split",
  "who": "One muscle group per day. For 5 days a week.",
  "target": 5,
  "days": {
   "Chest": [
    "Bench press",
    "Incline bench press",
    "Chest press",
    "Pec deck",
    "Dips (chest)"
   ],
   "Back": [
    "Lat pulldown",
    "Bent-over row",
    "Seated cable row",
    "Pull-up",
    "Back extension"
   ],
   "Legs": [
    "Squat",
    "Leg press",
    "Romanian deadlift",
    "Leg extension",
    "Lying leg curl",
    "Standing calf raise"
   ],
   "Shoulders": [
    "Shoulder press",
    "Lateral raise",
    "Rear delt fly",
    "Face pull",
    "Shrug"
   ],
   "Arms": [
    "Biceps curl",
    "Hammer curl",
    "Preacher curl",
    "Triceps pushdown",
    "Overhead triceps extension"
   ]
  }
 }
];
