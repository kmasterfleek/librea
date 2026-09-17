# Grade 8: Everything Can Be Searched

**Theme**: Intelligence and Structure
**Core Capacity**: Understanding how machines organize, search, and reason about high-dimensional data — and how that mirrors human cognition

---

## Philosophy

Eighth grade is the year the curtain comes down. Students have spent eight years building embodied intuition for dimensional thinking. Now they learn how computers do the same thing — and discover that the algorithms aren't magic. They're formalizations of processes students already understand. Nearest-neighbor search? They've been doing it since Grade 4. Indexing for fast retrieval? They built songline knowledge graphs in Grade 2. Clustering? They've been eyeballing it in the Situation Room since Grade 5.

This year, students learn about **HNSW graphs** (hierarchical navigable small world), **embedding spaces**, and the basics of how neural networks learn representations. Not as black boxes. As structures they can draw, walk, and build with their hands before they see them on screen. By June, every student understands — at a structural level — how a search engine, recommendation system, or AI model organizes information.

---

## Daily Structure

| Time | Block | What Happens |
|------|-------|-------------|
| 8:00-8:30 | Garden Morning | Tend plot. Sensor data now feeds into a class vector database. Students query it: "Find the days most similar to today across all our plots." |
| 8:30-9:15 | Intelligence Lab | How do machines search, sort, and learn? Graph structures, embedding spaces, neural network basics. Hands-on before screen. |
| 9:15-10:00 | Reading & Writing | Technical reading (simplified research papers, data journalism). Students write technical explanations for non-expert audiences. |
| 10:00-10:15 | Break | |
| 10:15-11:00 | Math | Exponents, roots, basic algebra. Distance formulas in n-dimensions. Introduction to matrices as "stacks of vectors." |
| 11:00-11:45 | Situation Room (Active) | Full participation. Students design queries, propose analyses, and present findings to the school community. |
| 11:45-12:30 | Lunch + Recess | |
| 12:30-1:15 | Build Lab | Build physical and digital models: HNSW graph on a bulletin board, a simple vector search engine in code, a recommendation system for the school library. |
| 1:15-2:00 | AI Foundations | How neural networks learn: weights, training, loss. Spiking neural networks as biological analogy. Students train simple models on their own data. |
| 2:00-2:20 | Mentor Time | Teach Grade 5-6 students. This year: design a lesson that explains a complex idea using physical models. |
| 2:20-2:35 | Closing Circle | "Something I thought was magical that turned out to be structural..." |

---

## Key Practices

### The Bulletin Board HNSW
Students build an HNSW graph on a physical bulletin board. Each index card is a vector (a garden data point, a student profile, a book description). Students connect cards with string based on similarity — close vectors get connected. Then they add layers: a sparse "express" layer of long-range connections on top. To search, start at the top layer, follow connections downward. Students physically walk the graph to find nearest neighbors.

When they later see the algorithm on screen, it's not new. They built it with index cards and string.

### Embedding by Hand
Students take 20 books from the school library. They describe each with 5 numbers: reading level, page count, "adventure score" (1-10), "sadness score" (1-10), "humor score" (1-10). They plot books in this 5D space (projected to 2D or 3D). Books that feel similar cluster together. Books that feel different are far apart.

Then: "A computer does this with thousands of dimensions for every sentence in every book. The math is the same. The scale is different."

### Training a Simple Model
Using a visual tool or simple Python, students train a classifier on their own garden data: given this week's sensor vector, predict whether the plants will grow, plateau, or decline. They see the model improve with more data. They see it fail on unusual weeks. They discuss: "What's the model missing? What dimensions would help?"

### The Search Engine Project
In teams, students build a simple search system for a real school resource (library books, community organizations, student projects). Define the vectors. Index them. Build a query interface. Test with real users. This is the capstone project of middle school — students ship a working vector search tool.

---

## How Traditional Subjects Map

| Standard Subject | Omega Grade 8 |
|------------------|-------------------|
| Math | Algebra foundations, exponents, matrices as vector collections, distance in n-dimensions. "What happens to distance when you add a 6th dimension?" |
| ELA | Technical writing, explanatory essays for lay audiences, reading data journalism and simplified ML research papers. |
| Science | Experimental design with predictive models. "Can our model predict garden outcomes? Where does it fail? Why?" |
| Social Studies | How search and recommendation algorithms shape society. Filter bubbles, algorithmic bias, who decides what dimensions matter. |
| Art | Information architecture, data visualization design, the aesthetics of making complex systems legible. |
| Technology | Basic programming for vector operations, simple ML training, database design, query interfaces. |

---

## Observable Growth

By June, an eighth grader can:

- Explain how HNSW graphs organize vectors for fast search
- Build a physical model of a vector index and demonstrate search on it
- Describe how a neural network learns (weights, training data, loss function) in plain language
- Train a simple model on their own data and evaluate its performance
- Design and build a working vector search tool for a real use case
- Read a Situation Room visualization and propose a follow-up analysis
- Write a technical explanation that a fifth grader could understand

---

## The Key Insight for This Year

When a student builds a search engine for the school library using book vectors and a classmate searches "something like *Hatchet* but funnier" and the system returns three books the classmate loves — the student has just experienced the full pipeline: **define dimensions → collect data → embed as vectors → index for search → retrieve by similarity → validate with a real user**. This is the same pipeline that powers Google, Spotify recommendations, and the student vector system in the Situation Room.

The eighth grader who has built this understands that AI is not intelligent in the way humans are. It is *structurally organized* in a way that produces useful results. The magic is in the structure — the same structure they first encountered as a songline in second grade, then as a stick chart in fourth, then as a garden vector in fifth. The formalization is new. The intuition is eight years old.
