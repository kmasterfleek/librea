# Grade 6: Everything Is a Vector

**Theme**: The Language of Measurement
**Core Capacity**: Understanding that any thing, person, or situation can be described as a list of numbers — and that list *is* a vector

---

## Philosophy

Sixth grade is the year the word **vector** enters the vocabulary. Not as abstract algebra. As the natural name for what children have been doing since kindergarten. They've been tying knots to count. Describing apples with 5 numbers. Building 8-dimension garden profiles. Comparing themselves using 10 self-chosen measurements. Now they learn: that list of numbers has a name. It's a vector. And vectors are how the modern world organizes, searches, and understands information.

This is also the year the **ESP32 device** appears. Each student receives a small programmable sensor board. The garden is no longer measured only by hand — it is measured by instruments that generate vectors automatically. The gap between embodied knowledge and computational knowledge begins to close.

---

## Daily Structure

| Time | Block | What Happens |
|------|-------|-------------|
| 8:00-8:30 | Garden Morning | Tend plot. ESP32 sensors now supplement hand measurement. Students compare sensor readings to their own observations: where do they agree? Where do they diverge? |
| 8:30-9:15 | Vector Lab | Core exploration: What is a vector? How do you compare two vectors? Distance, similarity, and the question of *which dimensions matter for which question*. |
| 9:15-10:00 | Reading & Writing | Nonfiction reading on data, measurement, and systems. Persuasive and analytical writing: "Why these dimensions and not others?" |
| 10:00-10:15 | Break | |
| 10:15-11:00 | Math | Ratios, percentages, negative numbers, coordinate geometry in 2D and 3D. Introduction to distance formulas. |
| 11:00-11:45 | Data Project | Semester-long investigation: choose a community phenomenon, define dimensions, collect data, build vectors, find patterns. |
| 11:45-12:30 | Lunch + Recess | |
| 12:30-1:15 | Situation Room | Active participation begins. Students read visualizations, propose questions, and see their own data rendered in vector space. |
| 1:15-2:00 | Device Lab | Program ESP32 sensors: temperature, humidity, light, soil moisture. Write simple code to log readings. Discuss: "Your sensor produces a vector every 10 seconds." |
| 2:00-2:20 | Mentor Time | Teach Grade 3-4 students. Design activities that make dimensional thinking tangible. |
| 2:20-2:35 | Closing Circle | "A vector I built today that surprised me was..." |

---

## Key Practices

### Naming the Vector
The first week: teacher holds up a familiar object. "Describe this in 5 numbers." Children do it easily — they've practiced since Grade 4. Teacher writes the list on the board. "This list has a name. It's called a **vector**. You've been making vectors for two years. Now you know what to call them."

No fanfare. No new concept. Just a name for something they already own.

### The ESP32 Garden Sensor
Each student builds a sensor station for their garden plot. The device reads soil moisture, temperature, light level, and humidity every hour. By week three, students have hundreds of 4-dimensional vectors — more data than they could ever collect by hand. The questions shift: "How do I find the days that were *most similar* to today? How do I find the *outlier* readings?"

This is the introduction to **vector search** through lived experience.

### Distance and Similarity
Students learn two ways to compare vectors:
1. **Euclidean distance** — "How far apart are these two points?" Introduced through physical plotting on graph paper, then extended to 3D, then discussed for higher dimensions.
2. **Cosine similarity** — "Are these two vectors pointing in the same direction?" Introduced through the metaphor: "Two gardens might be different sizes but have the same *shape* of readings."

By spring, students can articulate when each measure is more useful.

### The $OMEGAHEARTS Economy
The school's internal value-exchange system begins. Students earn $OMEGAHEARTS for contributions to the community: mentoring younger students, sharing sensor data, publishing findings. They spend them on device components, garden supplies, or Situation Room time. The economy itself becomes a data source — transaction vectors that students analyze.

---

## How Traditional Subjects Map

| Standard Subject | Omega Grade 6 |
|------------------|-------------------|
| Math | Ratios, percentages, coordinate geometry, distance formulas. "How far apart are these two vectors?" |
| ELA | Analytical writing, data-driven arguments, technical documentation of investigations. "Explain your methodology." |
| Science | Sensor-based data collection, experimental design with controlled variables, longitudinal environmental monitoring. |
| Social Studies | How data describes communities. Census data as vectors. "What dimensions does the government measure about a neighborhood?" |
| Art | Data sculpture: physical 3D representations of vector data using wire, clay, or found materials. |
| Technology | ESP32 programming basics, sensor calibration, data logging, simple visualization code. |

---

## Observable Growth

By June, a sixth grader can:

- Define "vector" in their own words and give three examples from their life
- Program an ESP32 to collect and log 4+ sensor dimensions
- Compare two vectors using both distance and similarity and explain which is appropriate
- Navigate the Situation Room displays and ask data-driven questions
- Conduct a semester-long investigation using self-collected vector data
- Articulate why the same object needs different vectors for different questions
- Participate in the $OMEGAHEARTS economy and analyze transaction patterns

---

## The Key Insight for This Year

When a student looks at 30 days of garden sensor data and says "Days 12 and 23 had almost the same vector — same moisture, same temp, same light — but the plants grew on day 12 and didn't on day 23, so there must be a dimension we're not measuring" — they have just discovered **missing dimensions**. They've identified that their vector is incomplete and hypothesized what's absent.

This is the same reasoning a data scientist uses when a model underperforms: the feature space is missing a signal. The student arrived there not through statistics lectures but through watching their tomatoes grow. The ESP32 gave them enough data to see what the data *doesn't* contain. That gap — between what's measured and what matters — is the central question of data science. Sixth graders are asking it about their gardens.
