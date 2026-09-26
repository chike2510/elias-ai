export type DeveloperResource = {
  slug: string;
  name: string;
  owner: string;
  url: string;
  description: string;
  category: "Learn" | "Build" | "Explore" | "Architecture" | "Interview";
  tags: string[];
};

export const developerResources: DeveloperResource[] = [
  { slug: "build-your-own-x", name: "Build Your Own X", owner: "codecrafters-io", url: "https://github.com/codecrafters-io/build-your-own-x", description: "Learn how technologies work by building them from scratch.", category: "Build", tags: ["projects", "fundamentals"] },
  { slug: "public-apis", name: "Public APIs", owner: "public-apis", url: "https://github.com/public-apis/public-apis", description: "Find public APIs for prototypes, experiments, and integrations.", category: "Explore", tags: ["apis", "prototyping"] },
  { slug: "system-design-primer", name: "System Design Primer", owner: "donnemartin", url: "https://github.com/donnemartin/system-design-primer", description: "Study scalability, databases, caching, and distributed systems.", category: "Architecture", tags: ["architecture", "scalability"] },
  { slug: "developer-roadmap", name: "Developer Roadmap", owner: "kamranahmedse", url: "https://github.com/kamranahmedse/developer-roadmap", description: "Choose a practical path through skills, tools, and concepts.", category: "Learn", tags: ["learning", "career"] },
  { slug: "project-based-learning", name: "Project-Based Learning", owner: "practical-tutorials", url: "https://github.com/practical-tutorials/project-based-learning", description: "Turn a topic into a sequence of projects you can actually finish.", category: "Build", tags: ["learning", "projects"] },
  { slug: "freecodecamp", name: "freeCodeCamp", owner: "freeCodeCamp", url: "https://github.com/freeCodeCamp/freeCodeCamp", description: "Structured, hands-on learning across web development and more.", category: "Learn", tags: ["courses", "web"] },
  { slug: "free-programming-books", name: "Free Programming Books", owner: "EbookFoundation", url: "https://github.com/EbookFoundation/free-programming-books", description: "A broad reference shelf of free programming books and resources.", category: "Learn", tags: ["books", "reference"] },
  { slug: "awesome-python", name: "Awesome Python", owner: "vinta", url: "https://github.com/vinta/awesome-python", description: "A curated map of useful Python libraries and tools.", category: "Explore", tags: ["python", "libraries"] },
  { slug: "coding-interview-university", name: "Coding Interview University", owner: "jwasham", url: "https://github.com/jwasham/coding-interview-university", description: "A self-paced path for algorithms and technical interviews.", category: "Interview", tags: ["algorithms", "interviews"] },
  { slug: "awesome", name: "Awesome", owner: "sindresorhus", url: "https://github.com/sindresorhus/awesome", description: "Discover focused, community-curated lists across technology.", category: "Explore", tags: ["curation", "discovery"] },
];
