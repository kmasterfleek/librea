// Static tables for the Librea Alt seed: synthetic names, the course catalog a
// continuation / independent-study school actually offers, and the sentence
// stock the fragments are built from. No real person, school, or record here.

export const FIRST = ['Amaya', 'Dominic', 'Keila', 'Marcus', 'Yesenia', 'Tobias', 'Nia', 'Rafael', 'Sierra', 'Jamal', 'Priya', 'Devon', 'Ximena', 'Kai', 'Bianca', 'Omar', 'Tanisha', 'Ezra', 'Marisol', 'Trevon', 'Leilani', 'Santiago', 'Brooke', 'Malik', 'Adriana', 'Cody', 'Fatima', 'Jaxon', 'Imani', 'Esteban', 'Rowan', 'Guadalupe', 'Darius', 'Hazel', 'Emilio', 'Skye', 'Andre', 'Rosalinda', 'Bodhi', 'Jocelyn', 'Tyrell', 'Analise', 'Quinn', 'Ignacio', 'Destiny', 'Levi', 'Aaliyah', 'Ruben', 'Winter', 'Jeremiah', 'Citlali', 'Shane', 'Nevaeh', 'Abel', 'Paloma', 'Dante', 'Jasmin', 'Kellen', 'Araceli', 'Zion', 'Lorena', 'Beckett', 'Talia', 'Cruz', 'Mireya', 'Josiah', 'Selena', 'Nash', 'Anaya', 'Salvador'];

export const LAST = ['Aguilar', 'Barnes', 'Calderon', 'Dumas', 'Escobar', 'Farrow', 'Gallegos', 'Hollins', 'Ibarra', 'Jennings', 'Kowalczyk', 'Lozano', 'Mendez', 'Njoku', 'Okafor', 'Prieto', 'Quintanilla', 'Reyes', 'Salcedo', 'Trujillo', 'Ulibarri', 'Vargas', 'Whitcomb', 'Xiong', 'Yazzie', 'Zamora', 'Alcaraz', 'Boone', 'Castellanos', 'Delgado', 'Eastman', 'Fontenot', 'Guzman', 'Hidalgo', 'Ingram', 'Juarez', 'Keahi', 'Lindgren', 'Marrero', 'Nakashima', 'Ortega', 'Peralta', 'Robles', 'Serrano', 'Tapia', 'Valdivia', 'Weatherby', 'Yamada', 'Zepeda', 'Aranda'];

export const STAFF = [
  { first: 'Rosa', last: 'Mendoza', role: 'principal', title: 'Director' },
  { first: 'Curtis', last: 'Beaumont', role: 'counselor', title: 'School Counselor' },
  { first: 'Yvette', last: 'Sandoval', role: 'counselor', title: 'Case Manager (Special Education)' },
  { first: 'Hank', last: 'Ojeda', role: 'staff', title: 'Registrar' },
  { first: 'Pearl', last: 'Whitcomb', role: 'staff', title: 'Attendance & ADA Clerk' },
  { first: 'Desmond', last: 'Ford', role: 'teacher', title: 'Advisor — English & Independent Study' },
  { first: 'Anita', last: 'Kaur', role: 'teacher', title: 'Advisor — Mathematics' },
  { first: 'Gil', last: 'Navarro', role: 'teacher', title: 'Advisor — Science' },
  { first: 'Terri', last: 'Blackfeather', role: 'teacher', title: 'Advisor — Social Studies & Culture' },
  { first: 'Lou', last: 'Pham', role: 'teacher', title: 'Advisor — Career & Technical Education' },
  { first: 'Shauna', last: 'Reyes', role: 'teacher', title: 'Advisor — Credit Recovery Lab' },
  { first: 'Mateo', last: 'Iglesias', role: 'teacher', title: 'Advisor — PE, Health & Transition' },
];

/** Course catalog. `credits` is credits per semester section (5 is the common unit). */
export const COURSES = [
  { code: 'ENG-9', title: 'English 9', subject: 'English', credits: 5, grades: [9, 10], req: 'english' },
  { code: 'ENG-10', title: 'English 10', subject: 'English', credits: 5, grades: [10, 11], req: 'english' },
  { code: 'ENG-11', title: 'American Literature', subject: 'English', credits: 5, grades: [11, 12], req: 'english' },
  { code: 'ENG-12', title: 'Expository Reading & Writing', subject: 'English', credits: 5, grades: [12], req: 'english' },
  { code: 'MTH-1', title: 'Algebra I', subject: 'Math', credits: 5, grades: [8, 9, 10], req: 'math' },
  { code: 'MTH-2', title: 'Geometry', subject: 'Math', credits: 5, grades: [10, 11], req: 'math' },
  { code: 'MTH-3', title: 'Algebra II', subject: 'Math', credits: 5, grades: [11, 12], req: 'math' },
  { code: 'MTH-4', title: 'Financial Math', subject: 'Math', credits: 5, grades: [11, 12], req: 'math' },
  { code: 'SCI-1', title: 'Living Earth (Biology)', subject: 'Science', credits: 5, grades: [9, 10], req: 'science' },
  { code: 'SCI-2', title: 'Chemistry in the Earth System', subject: 'Science', credits: 5, grades: [10, 11], req: 'science' },
  { code: 'SCI-3', title: 'Environmental Science', subject: 'Science', credits: 5, grades: [11, 12], req: 'science' },
  { code: 'SOC-1', title: 'World History', subject: 'Social Studies', credits: 5, grades: [10, 11], req: 'social' },
  { code: 'SOC-2', title: 'U.S. History', subject: 'Social Studies', credits: 5, grades: [11, 12], req: 'social' },
  { code: 'SOC-3', title: 'Government & Economics', subject: 'Social Studies', credits: 5, grades: [12], req: 'social' },
  { code: 'PE-1', title: 'Physical Education', subject: 'PE', credits: 5, grades: [9, 10, 11, 12], req: 'pe' },
  { code: 'HLT-1', title: 'Health & Wellness', subject: 'Health', credits: 5, grades: [9, 10, 11, 12], req: 'health' },
  { code: 'CTE-1', title: 'Construction Trades Pathway', subject: 'CTE', credits: 5, grades: [10, 11, 12], req: 'elective' },
  { code: 'CTE-2', title: 'Culinary Arts', subject: 'CTE', credits: 5, grades: [10, 11, 12], req: 'elective' },
  { code: 'CTE-3', title: 'Digital Media Production', subject: 'CTE', credits: 5, grades: [9, 10, 11, 12], req: 'elective' },
  { code: 'IS-1', title: 'Independent Study Seminar', subject: 'Independent Study', credits: 5, grades: [9, 10, 11, 12], req: 'elective' },
  { code: 'CR-1', title: 'Credit Recovery Lab', subject: 'Credit Recovery', credits: 5, grades: [9, 10, 11, 12], req: 'elective' },
  { code: 'CUL-1', title: 'Community, Language & Place', subject: 'Culture', credits: 5, grades: [9, 10, 11, 12], req: 'elective' },
];

/** Credits needed for a diploma, and the pace a student should be on by grade. */
export const CREDITS_TO_GRADUATE = 180;
export const CREDITS_EXPECTED = { 8: 0, 9: 0, 10: 45, 11: 90, 12: 135 };

export const SELF = [
  'I came here because the big school stopped working for me. I show up better when someone knows my name.',
  'I work nights at my uncle’s shop. Mornings are hard but I would rather be here than not.',
  'I want to finish. I am {behind} credits behind and I know exactly how many that is.',
  'I like {interest}. It is the only thing I do where I lose track of time.',
  'I have a kid. Everything I do here is for the two of us.',
  'I read better than people think. I just do not like reading out loud.',
  'My plan is trades. I do not need a lecture about college, I need my hours.',
  'I moved four times in two years. This is the first school I have stayed at past Christmas.',
  'Independent study works for me because I can do the work at 11pm when it is quiet.',
  'I am not behind because I am dumb. I was taking care of my grandma.',
  'I want to graduate before my little sister starts high school so she sees it can be done.',
  'Last year I came maybe twenty days. This year I am at almost every day and nobody has said anything about it.',
  'I like {interest} and I want a job in it, not just a class about it.',
  'When I miss a day it is usually transportation. The bus route changed.',
  'I have a plan on file. It helps. I wish people would read it before they meet me.',
];

export const INTERESTS = ['welding', 'cooking', 'making beats', 'my car', 'drawing', 'coding', 'my dog', 'basketball', 'tattoo art', 'fixing phones', 'photography', 'lowriders', 'baking', 'ranch work', 'sewing', 'gaming', 'poetry', 'skating', 'hair', 'engines'];

/** Advisor case notes (visibility 'staff'). */
export const CASE_NOTES = [
  'Caseload check-in. On pace this term if the CTE credit posts. Revisit after progress grades.',
  'Transportation is the whole story here. Bus pass sorted through the county; watch the next two weeks.',
  'Down to {behind} credits behind. Showed them the credit tracker and they asked to add a sixth course. Approved.',
  'Working nights. We moved their independent-study check-in to Thursday afternoons and attendance improved.',
  'Behavior plan is doing its job — two incidents last term, none this one. Keep the same de-escalation script.',
  'Parent contact made. Mom asks for texts, not calls, and Spanish if possible.',
  'Student is 18 and has asked that guardian access be closed. Documented and honored.',
  'IEP annual is coming up. Case manager has the invite out; needs the general-ed input form back.',
  'Housing is unstable right now. Flagged for the county liaison; no residency documents requested.',
  'Wants the construction pathway. Needs Algebra I finished first — credit recovery lab is the fastest route.',
  'Good week. Finished two packets and stayed for lunch, which is new.',
  'Transfer credits from the prior district finally arrived. Registrar is posting them; total will move up next week.',
  'Court date on the calendar; excused and the work travels with them.',
  'Reads well above what the file says. Moved to the American Lit section instead of the recovery packet.',
  'Third meeting in a row where the student led. Transition plan should say so.',
];

/** Contact / re-engagement log entries (kind 'record', visibility 'staff'). */
export const CONTACT_LOG = [
  'Called home {ago}. No answer, left a voicemail with my direct line.',
  'Texted {ago}. They replied: transportation. Bus pass in progress.',
  'Home visit {ago} with the counselor. Family says they will be back Monday.',
  'Spoke with student {ago}. Working days to cover rent; asked about the evening independent-study option.',
  'Called {ago}. Grandmother in the hospital, student has been at the hospital with her. Excused.',
  'Contacted {ago}. Student came in the next morning and picked up packets.',
  'Called {ago}. Number disconnected. Registrar is checking for a newer contact.',
  'Reached the student directly {ago}. They are embarrassed about how far behind they are. Meeting Thursday to map credits.',
  'Emailed and texted {ago}, no response yet. SART letter is the next step if this week is the same.',
  'Talked {ago}. Child care fell through. Referred to the county program; attendance should recover.',
];

export const GOALS = [
  'Earn 30 credits this semester and stay on pace for a June graduation.',
  'Attend 90% of scheduled days for six consecutive weeks.',
  'Complete Algebra I through the credit recovery lab by the end of the term.',
  'Use the agreed de-escalation plan instead of leaving campus.',
  'Finish the CTE pathway hours and hold a work permit in good standing.',
  'Complete a college or trade-school application with the counselor by March.',
  'Check in with the advisor every Thursday and submit two packets a week.',
];

export const RELATIONS = ['mother', 'father', 'grandmother', 'grandfather', 'aunt', 'uncle', 'older sister', 'older brother', 'foster parent', 'legal guardian'];
export const LANGS = ['English', 'Spanish', 'Spanish', 'Spanish', 'Hmong', 'Tagalog', 'Mixteco', 'Vietnamese', 'Dine bizaad', 'Arabic'];

export const INCIDENT_TYPES = ['classroom disruption', 'left campus without permission', 'verbal conflict with a peer', 'phone use after redirection', 'defiance of staff direction', 'possession of tobacco/vape', 'property damage'];
export const INCIDENT_ACTIONS = ['restorative conversation', 'advisor conference', 'parent contact', 'counselor referral', 'behavior plan review', 'one-day in-school placement', 'community circle'];

export const DOC_TYPES = [
  { type: 'enrollment-form', title: 'Enrollment form' },
  { type: 'emergency-card', title: 'Emergency contact card' },
  { type: 'residency', title: 'Proof of residency' },
  { type: 'transcript-request', title: 'Prior-school transcript request' },
];

export const CRED_TYPES = [
  { type: 'background-check', title: 'DOJ/FBI background clearance' },
  { type: 'mandated-reporter', title: 'Mandated reporter training' },
  { type: 'cpr-first-aid', title: 'CPR & first aid' },
  { type: 'credential', title: 'Teaching credential' },
];

export const DRILL_TYPES = ['fire', 'earthquake', 'lockdown', 'evacuation'];

/** The secondary-entry vaccines most states ask to see. `ageYears` dates the last dose. */
export const VACCINES = [
  { code: 'dtap', name: 'DTaP/Tdap', doses: 5, ageYears: 11 },
  { code: 'polio', name: 'Polio (IPV)', doses: 4, ageYears: 6 },
  { code: 'mmr', name: 'MMR', doses: 2, ageYears: 5 },
  { code: 'hepb', name: 'Hepatitis B', doses: 3, ageYears: 1 },
  { code: 'varicella', name: 'Varicella', doses: 2, ageYears: 5 },
];
