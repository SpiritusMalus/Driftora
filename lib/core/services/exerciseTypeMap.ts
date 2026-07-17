import type { WorkoutType } from '../insights/bodyMetrics';

/// Maps OS exercise vocabularies onto the app's [WorkoutType] set (which drives
/// the MET fallback when a session carries no measured energy). Pure data + two
/// lookups, jest-tested against the real constants:
///  - Health Connect: integer ExerciseType codes (react-native-health-connect
///    src/constants.ts / androidx ExerciseSessionRecord).
///  - HealthKit: HKWorkoutActivityType names as react-native-health prints them
///    (`activityName` from getAnchoredWorkouts).
/// Anything unmapped → 'other' — imported with a generic conditioning MET and a
/// visible «≈», never silently dropped.

const HC_TO_TYPE: Record<number, WorkoutType> = {
  // walk
  79: 'walk', // WALKING
  37: 'walk', // HIKING
  // run
  56: 'run', // RUNNING
  57: 'run', // RUNNING_TREADMILL
  // cycle
  8: 'cycle', // BIKING
  9: 'cycle', // BIKING_STATIONARY
  // swim
  73: 'swim', // SWIMMING_OPEN_WATER
  74: 'swim', // SWIMMING_POOL
  // strength (machines, free weights, bodyweight)
  70: 'strength', // STRENGTH_TRAINING
  81: 'strength', // WEIGHTLIFTING
  13: 'strength', // CALISTHENICS
  6: 'strength', // BENCH_PRESS
  17: 'strength', // DEADLIFT
  67: 'strength', // SQUAT
  42: 'strength', // LAT_PULL_DOWN
  3: 'strength', // BARBELL_SHOULDER_PRESS
  1: 'strength', // BACK_EXTENSION
  18: 'strength', // DUMBBELL_CURL_LEFT_ARM
  19: 'strength', // DUMBBELL_CURL_RIGHT_ARM
  20: 'strength', // DUMBBELL_FRONT_RAISE
  21: 'strength', // DUMBBELL_LATERAL_RAISE
  22: 'strength', // DUMBBELL_TRICEPS_EXTENSION_LEFT_ARM
  23: 'strength', // DUMBBELL_TRICEPS_EXTENSION_RIGHT_ARM
  24: 'strength', // DUMBBELL_TRICEPS_EXTENSION_TWO_ARM
  43: 'strength', // LUNGE
  15: 'strength', // CRUNCH
  7: 'strength', // BENCH_SIT_UP
  49: 'strength', // PLANK
  12: 'strength', // BURPEE
  40: 'strength', // JUMPING_JACK
  // hiit / circuit
  36: 'hiit', // HIGH_INTENSITY_INTERVAL_TRAINING
  10: 'hiit', // BOOT_CAMP
  26: 'hiit', // EXERCISE_CLASS
  41: 'hiit', // JUMP_ROPE
  // elliptical / stairs
  25: 'elliptical', // ELLIPTICAL
  68: 'elliptical', // STAIR_CLIMBING
  69: 'elliptical', // STAIR_CLIMBING_MACHINE
  // row / paddle
  53: 'row', // ROWING
  54: 'row', // ROWING_MACHINE
  46: 'row', // PADDLING
  // ball / racket sports
  5: 'sport', // BASKETBALL
  64: 'sport', // SOCCER
  28: 'sport', // FOOTBALL_AMERICAN
  29: 'sport', // FOOTBALL_AUSTRALIAN
  78: 'sport', // VOLLEYBALL
  76: 'sport', // TENNIS
  75: 'sport', // TABLE_TENNIS
  2: 'sport', // BADMINTON
  66: 'sport', // SQUASH
  50: 'sport', // RACQUETBALL
  35: 'sport', // HANDBALL
  4: 'sport', // BASEBALL
  65: 'sport', // SOFTBALL
  14: 'sport', // CRICKET
  55: 'sport', // RUGBY
  38: 'sport', // ICE_HOCKEY
  52: 'sport', // ROLLER_HOCKEY
  32: 'sport', // GOLF
  31: 'sport', // FRISBEE_DISC
  // dance
  16: 'dance', // DANCING
  // martial
  44: 'martial', // MARTIAL_ARTS
  11: 'martial', // BOXING
  27: 'martial', // FENCING
  // yoga / mobility
  83: 'yoga', // YOGA
  48: 'yoga', // PILATES
  71: 'yoga', // STRETCHING
  33: 'yoga', // GUIDED_BREATHING
};

/// Health Connect ExerciseSession.exerciseType (int) → app type.
export function workoutTypeFromHcExerciseType(code: number): WorkoutType | 'other' {
  return HC_TO_TYPE[code] ?? 'other';
}

const HK_TO_TYPE: Record<string, WorkoutType> = {
  Walking: 'walk',
  Hiking: 'walk',
  Running: 'run',
  Cycling: 'cycle',
  HandCycling: 'cycle',
  Swimming: 'swim',
  WaterFitness: 'swim',
  TraditionalStrengthTraining: 'strength',
  FunctionalStrengthTraining: 'strength',
  CoreTraining: 'strength',
  HighIntensityIntervalTraining: 'hiit',
  CrossTraining: 'hiit',
  MixedCardio: 'hiit',
  JumpRope: 'hiit',
  StepTraining: 'hiit',
  Elliptical: 'elliptical',
  StairClimbing: 'elliptical',
  Stairs: 'elliptical',
  Rowing: 'row',
  PaddleSports: 'row',
  Basketball: 'sport',
  Soccer: 'sport',
  AmericanFootball: 'sport',
  AustralianFootball: 'sport',
  Tennis: 'sport',
  TableTennis: 'sport',
  Badminton: 'sport',
  Squash: 'sport',
  Racquetball: 'sport',
  Handball: 'sport',
  Baseball: 'sport',
  Softball: 'sport',
  Cricket: 'sport',
  Rugby: 'sport',
  Hockey: 'sport',
  Volleyball: 'sport',
  Golf: 'sport',
  DiscSports: 'sport',
  Pickleball: 'sport',
  Lacrosse: 'sport',
  TrackAndField: 'sport',
  Dance: 'dance',
  CardioDance: 'dance',
  SocialDance: 'dance',
  Barre: 'dance',
  MartialArts: 'martial',
  Boxing: 'martial',
  Kickboxing: 'martial',
  Wrestling: 'martial',
  Fencing: 'martial',
  TaiChi: 'martial',
  Yoga: 'yoga',
  Pilates: 'yoga',
  Flexibility: 'yoga',
  MindAndBody: 'yoga',
  PreparationAndRecovery: 'yoga',
  Cooldown: 'yoga',
};

/// HealthKit activityName (string from getAnchoredWorkouts) → app type.
export function workoutTypeFromHkActivity(name: string): WorkoutType | 'other' {
  return HK_TO_TYPE[name] ?? 'other';
}
