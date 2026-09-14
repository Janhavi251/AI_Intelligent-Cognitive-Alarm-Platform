import random
import uuid
import os
import json
from typing import Dict, Any, List, Tuple
from dotenv import load_dotenv
try:
    from schemas import ChallengeResponse
except ImportError:
    from backend.schemas import ChallengeResponse

# Load .env
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# ══════════════════════════════════════════════════════════════
#  GEMINI AI INTEGRATION
# ══════════════════════════════════════════════════════════════

def generate_with_gemini(challenge_type: str, difficulty: str) -> dict | None:
    """
    Calls Gemini API to generate a fresh cognitive challenge.
    Returns a dict with question, options, answer, hint — or None if it fails.
    Falls back to static generator on any error.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")

        type_descriptions = {
            "math":    "a multi-step arithmetic problem (addition, subtraction, multiplication, division)",
            "logic":   "a logical reasoning puzzle (ordering, boolean logic, or syllogism)",
            "memory":  "a digit or color sequence memory challenge",
            "word":    "an anagram or word unscramble puzzle",
            "pattern": "a number sequence pattern recognition challenge",
            "riddle":  "a classic lateral thinking riddle",
            "quiz":    "a general knowledge or science trivia question"
        }

        type_desc = type_descriptions.get(challenge_type, "a cognitive challenge")

        prompt = f"""Generate {type_desc} at {difficulty} difficulty level for a cognitive alarm app.

Return ONLY valid JSON in this exact format, nothing else:
{{
  "question": "the challenge question text",
  "options": ["option1", "option2", "option3", "option4"],
  "answer": "the correct answer",
  "hint": "a helpful hint"
}}

Rules:
- For math/pattern/memory: set "options" to [] and answer as plain number or text
- For logic/riddle/quiz: always provide exactly 4 options
- Keep question clear and solvable in under 60 seconds
- Difficulty levels: beginner (very simple, anyone can do it), easy (basic, straightforward), medium (requires some thinking), hard (challenging, multi-step), expert (advanced, deep reasoning required)
- Current difficulty {difficulty}: {"extremely simple, single-step" if difficulty == "beginner" else "simple and straightforward" if difficulty == "easy" else "moderately complex" if difficulty == "medium" else "challenging and requires deeper thinking" if difficulty == "hard" else "highly advanced, requires expert-level reasoning"}
"""

        response = model.generate_content(prompt)
        text = response.text.strip()

        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        data = json.loads(text)

        # Validate required fields
        if not all(k in data for k in ["question", "answer", "hint"]):
            return None

        return data

    except Exception as e:
        print(f"[Gemini] Fallback to static generator: {e}")
        return None

# ══════════════════════════════════════════════════════════════
#  MATH PROBLEMS
# ══════════════════════════════════════════════════════════════
def generate_math_problem(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Math Problems based on difficulty."""
    if difficulty == "beginner":
        op = random.choice(["+", "-"])
        a = random.randint(1, 10)
        b = random.randint(1, 9)
        if op == "-" and b > a:
            a, b = b, a
        question = f"Solve: {a} {op} {b} = ?"
        answer = str(eval(f"{a} {op} {b}"))
        hint = f"Count on your fingers if needed. Simple single-digit {'+' if op == '+' else 'subtraction'}."

    elif difficulty == "easy":
        op = random.choice(["+", "-"])
        a = random.randint(10, 50)
        b = random.randint(5, 45)
        if op == "-" and b > a:
            a, b = b, a
        question = f"Solve: {a} {op} {b} = ?"
        answer = str(eval(f"{a} {op} {b}"))
        hint = f"Simple 2-digit {'+' if op == '+' else 'subtraction'}."
    
    elif difficulty == "medium":
        op_type = random.choice(["mul", "mixed"])
        if op_type == "mul":
            a = random.randint(6, 15)
            b = random.randint(6, 14)
            c = random.randint(10, 50)
            question = f"Solve: ({a} × {b}) - {c} = ?"
            answer = str((a * b) - c)
        else:
            a = random.choice([24, 36, 48, 60, 72, 84, 96, 120])
            b = random.choice([3, 4, 6, 12])
            c = random.randint(15, 60)
            question = f"Solve: ({a} ÷ {b}) + {c} = ?"
            answer = str((a // b) + c)
        hint = "Perform operations inside parentheses first."
    
    elif difficulty == "hard":
        a = random.randint(12, 25)
        b = random.randint(7, 15)
        c = random.choice([36, 48, 64, 80, 100, 144])
        d = random.choice([4, 6, 8, 12])
        question = f"Solve: ({a} × {b}) + ({c} ÷ {d}) = ?"
        answer = str((a * b) + (c // d))
        hint = "Calculate both products/quotients then sum them up."

    else:  # expert
        a = random.randint(15, 30)
        b = random.randint(12, 20)
        c = random.randint(3, 9)
        d = random.randint(5, 12)
        e = random.choice([25, 36, 49, 64, 81, 100, 121, 144])
        question = f"Solve: ({a} × {b}) - ({c}² × {d}) + √{e} = ?"
        c_sq = c * c
        sqrt_e = int(e ** 0.5)
        answer = str((a * b) - (c_sq * d) + sqrt_e)
        hint = "Compute squares and square roots first, then left-to-right."

    return (
        "Math Challenge",
        "Calculate the correct numerical answer mentally as fast as possible.",
        question,
        [],
        "number",
        hint,
        answer
    )


# ══════════════════════════════════════════════════════════════
#  LOGIC PUZZLES
# ══════════════════════════════════════════════════════════════
def generate_logic_puzzle(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Logic Puzzles based on difficulty."""
    if difficulty == "beginner":
        puzzles = [
            ("If it is raining, do you need an umbrella?", ["Yes", "No"], "Yes", "Rain makes things wet — you'd want to stay dry."),
            ("Which number comes after 4?", ["5", "3", "6", "2"], "5", "Count forward: 1, 2, 3, 4, ?."),
            ("If a cat has 4 legs, how many legs do 2 cats have?", ["8", "4", "6", "10"], "8", "Simply multiply 4 × 2.")
        ]
        q, opts, ans, h = random.choice(puzzles)
    elif difficulty == "easy":
        puzzles = [
            ("If all Bloops are Razzies, and all Razzies are Lazzies, are all Bloops definitely Lazzies?", ["Yes", "No", "Cannot be determined"], "Yes", "Follow transitive logic: A -> B and B -> C means A -> C."),
            ("If a red house is made of red bricks, and a blue house is made of blue bricks, what is a greenhouse made of?", ["Glass", "Green bricks", "Plants", "Wood"], "Glass", "Think about standard greenhouse structures."),
            ("If Tuesday comes after Monday, and Thursday comes 2 days after Tuesday, what day is today if tomorrow is Thursday?", ["Wednesday", "Tuesday", "Thursday", "Monday"], "Wednesday", "Work backwards from tomorrow being Thursday.")
        ]
        q, opts, ans, h = random.choice(puzzles)
    elif difficulty == "medium":
        puzzles = [
            ("Alice is older than Bob. Charlie is younger than Bob. Who is the youngest?", ["Charlie", "Bob", "Alice", "Same age"], "Charlie", "Order them: Alice > Bob > Charlie."),
            ("If A = True, B = False, and C = True. What is the value of: (A AND B) OR C?", ["True", "False", "Undefined"], "True", "False OR True evaluates to True."),
            ("Five people were in a race. David finished before Ethan, but after Chloe. Chloe finished after Brenda. Who won the race?", ["Brenda", "Chloe", "David", "Ethan"], "Brenda", "Trace positions: Brenda > Chloe > David > Ethan.")
        ]
        q, opts, ans, h = random.choice(puzzles)
    elif difficulty == "hard":
        puzzles = [
            ("Statement 1: 'At least one of Statement 2 and 3 is false.' Statement 2: 'Statement 1 is true.' If Statement 1 is True, what is Statement 3?", ["False", "True", "Cannot be determined"], "False", "Since Stmt 1 is true, one of 2 or 3 MUST be false. Stmt 2 is true, so 3 must be false."),
            ("If X is true whenever Y is false, and Y is true whenever Z is true. If Z is true, what is X?", ["False", "True", "Unknown"], "False", "Z is true -> Y is true -> Y is NOT false -> X is false."),
            ("A drawer contains 10 black socks and 10 white socks. What is the minimum number of socks you must pull in the dark to guarantee a matching pair?", ["3", "11", "2", "10"], "3", "Pigeonhole principle: with 2 colors, 3 pulls guarantees at least 2 of the same color.")
        ]
        q, opts, ans, h = random.choice(puzzles)
    else:  # expert
        puzzles = [
            ("You have 3 boxes: one contains only apples, one only oranges, one both. All boxes are mislabeled. You pick one fruit from the 'Both' box — it's an apple. What do the other boxes actually contain?", ["Oranges-only and Both", "Apples-only and Both", "Both and Oranges", "Cannot determine"], "Oranges-only and Both", "Since 'Both' box is mislabeled and gave an apple, it's apples-only. The labels are ALL wrong, so deduce the rest by elimination."),
            ("A man is condemned. He can make one statement. If true, he is hanged; if false, he is drowned. He says: 'I will be drowned.' What happens?", ["Neither — paradox forces release", "He is hanged", "He is drowned", "Both punishments"], "Neither — paradox forces release", "If drowned, statement is true so he must be hanged. If hanged, statement is false so he must be drowned. Paradox — neither can be executed."),
            ("P implies Q. Q implies R. R is false. P is true or false?", ["False", "True", "Cannot determine", "Both"], "False", "R false → Q false (contrapositive of Q→R). Q false → P false (contrapositive of P→Q).")
        ]
        q, opts, ans, h = random.choice(puzzles)

    return (
        "Logic Puzzle",
        "Analyze the logic problem carefully and select the single correct logical conclusion.",
        q,
        opts,
        "choice",
        h,
        ans
    )


# ══════════════════════════════════════════════════════════════
#  MEMORY CHALLENGES
# ══════════════════════════════════════════════════════════════
def generate_memory_challenge(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Memory Challenges based on difficulty."""
    if difficulty == "beginner":
        digits = [str(random.randint(1, 9)) for _ in range(3)]
        seq_str = " - ".join(digits)
        answer = "".join(digits)
        question = f"Memorize this 3-digit sequence: {seq_str}"
        hint = "Say the digits out loud to yourself."
        instructions = "Memorize the sequence, then enter the digits in exact order."
    elif difficulty == "easy":
        digits = [str(random.randint(1, 9)) for _ in range(4)]
        seq_str = " - ".join(digits)
        answer = "".join(digits)
        question = f"Memorize this 4-digit sequence: {seq_str}"
        hint = "Remember the digits in exact left-to-right order."
        instructions = "Memorize the sequence, then enter the digits in exact order."
    elif difficulty == "medium":
        colors = ["Red", "Blue", "Green", "Yellow", "Orange", "Purple"]
        seq = [random.choice(colors) for _ in range(5)]
        question = f"Memorize this color sequence: {' -> '.join(seq)}"
        answer = "-".join(seq).lower()
        hint = "First letters: " + "".join([c[0] for c in seq])
        instructions = "Memorize the 5-color sequence, then enter color names separated by hyphens (e.g. red-blue-green)."
    elif difficulty == "hard":
        digits = [str(random.randint(1, 9)) for _ in range(7)]
        seq_str = " - ".join(digits)
        answer = "".join(reversed(digits))
        question = f"Memorize this 7-digit sequence: {seq_str}"
        hint = "IMPORTANT: You must enter these digits in REVERSE order!"
        instructions = "Memorize the 7 digits, then enter them in REVERSE order."
    else:  # expert
        shapes = ["circle", "triangle", "square", "star", "diamond", "pentagon", "hexagon"]
        seq = [random.choice(shapes) for _ in range(6)]
        question = f"Memorize this shape sequence: {' → '.join(seq)}"
        answer = "-".join(seq)
        hint = "Group them in pairs to help recall: " + f"{seq[0]}/{seq[1]}, {seq[2]}/{seq[3]}, {seq[4]}/{seq[5]}"
        instructions = "Memorize all 6 shapes in order, then enter them separated by hyphens (e.g. circle-star-square)."

    return (
        "Memory Challenge",
        instructions,
        question,
        [],
        "text",
        hint,
        answer
    )


# ══════════════════════════════════════════════════════════════
#  WORD GAMES
# ══════════════════════════════════════════════════════════════
def generate_word_game(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Word Games (Anagrams & Word Scrambles) based on difficulty."""
    if difficulty == "beginner":
        words = [
            ("CAT", "A common household pet that meows"),
            ("SUN", "The star at the center of our solar system"),
            ("RUN", "To move quickly on foot"),
            ("HAT", "A covering worn on the head"),
            ("BED", "A piece of furniture for sleeping")
        ]
    elif difficulty == "easy":
        words = [
            ("BRAIN", "The organ responsible for cognitive function"),
            ("ALARM", "A device that wakes you up in the morning"),
            ("SMART", "Possessing high intelligence or mental quickness"),
            ("FOCUS", "Concentration of attention on a central task"),
            ("LIGHT", "Natural agent that stimulates sight")
        ]
    elif difficulty == "medium":
        words = [
            ("NEURON", "A specialized cell transmitting nerve impulses"),
            ("MEMORY", "The faculty by which the brain stores information"),
            ("PUZZLE", "A game or problem designed to test ingenuity"),
            ("ACTIVE", "Engaged in action or mental movement"),
            ("REASON", "The power of the mind to think and comprehend")
        ]
    elif difficulty == "hard":
        words = [
            ("COGNITIVE", "Relating to mental processes of perception and judgment"),
            ("INTELLIGENT", "Having or showing intelligence and high analytical skill"),
            ("SYNAPSE", "A junction between two nerve cells"),
            ("PERCEPTION", "The ability to see, hear, or become aware through senses"),
            ("ALERTNESS", "The state of being active, attentive, and ready")
        ]
    else:  # expert
        words = [
            ("NEUROPLASTICITY", "The brain's ability to reorganize itself by forming new connections"),
            ("METACOGNITION", "Thinking about one's own thinking processes"),
            ("SUBCONSCIOUS", "The part of the mind below the level of conscious awareness"),
            ("CONSCIOUSNESS", "The state of being aware of your own existence"),
            ("PREFRONTAL", "Relating to the foremost part of the frontal lobe of the brain")
        ]

    target_word, hint_desc = random.choice(words)
    letters = list(target_word)
    scrambled = letters.copy()
    while scrambled == letters:
        random.shuffle(scrambled)
    
    question = f"Unscramble this word: {' '.join(scrambled)}"
    
    return (
        "Word Challenge",
        "Unscramble the letters to form the correct target word.",
        question,
        [],
        "text",
        f"Hint: {hint_desc} ({len(target_word)} letters)",
        target_word
    )


# ══════════════════════════════════════════════════════════════
#  PATTERN RECOGNITION
# ══════════════════════════════════════════════════════════════
def generate_pattern_recognition(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Pattern Recognition challenges based on difficulty."""
    if difficulty == "beginner":
        start = random.randint(1, 5)
        step = random.randint(1, 3)
        seq = [start + i * step for i in range(4)]
        next_val = start + 4 * step
        question = f"What comes next? {', '.join(map(str, seq))}, __?"
        answer = str(next_val)
        hint = f"Each number increases by the same amount (+{step})."

    elif difficulty == "easy":
        start = random.randint(2, 15)
        step = random.randint(3, 7)
        seq = [start + i * step for i in range(5)]
        next_val = start + 5 * step
        question = f"Identify the next number in the pattern: {', '.join(map(str, seq))}, __?"
        answer = str(next_val)
        hint = f"Constant addition pattern (+{step})."
    
    elif difficulty == "medium":
        pat_type = random.choice(["square", "doubling"])
        if pat_type == "square":
            offset = random.randint(1, 5)
            seq = [(i**2) + offset for i in range(1, 6)]
            next_val = (6**2) + offset
            hint = "Notice the quadratic growth (n² + offset)."
        else:
            start = random.randint(2, 5)
            seq = [start * (2**i) for i in range(5)]
            next_val = start * (2**5)
            hint = "Each term multiplies by 2."
        
        question = f"Find the missing next term: {', '.join(map(str, seq))}, __?"
        answer = str(next_val)
    
    elif difficulty == "hard":
        pat_type = random.choice(["fibonacci", "diff_growth"])
        if pat_type == "fibonacci":
            a, b = random.randint(1, 4), random.randint(3, 6)
            seq = [a, b]
            for _ in range(4):
                seq.append(seq[-1] + seq[-2])
            next_val = seq[-1] + seq[-2]
            hint = "Each term is the sum of the two preceding terms."
        else:
            curr = random.randint(2, 5)
            seq = [curr]
            for i in range(1, 6):
                curr += (i * 2)
                seq.append(curr)
            next_val = seq[-1] + (6 * 2)
            hint = "The difference between terms increases by +2 each step (+2, +4, +6, +8...)."

        question = f"Determine the next number in sequence: {', '.join(map(str, seq))}, __?"
        answer = str(next_val)

    else:  # expert
        pat_type = random.choice(["prime_gap", "triple_relation"])
        if pat_type == "prime_gap":
            primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]
            start_idx = random.randint(0, 5)
            seq = primes[start_idx:start_idx + 6]
            next_val = primes[start_idx + 6]
            hint = "These are prime numbers — divisible only by 1 and themselves."
        else:
            # Each term = prev² - constant
            a = random.randint(2, 4)
            k = random.randint(1, 3)
            seq = [a]
            for _ in range(4):
                a = a * a - k
                seq.append(a)
            next_val = seq[-1] * seq[-1] - k
            hint = f"Each term is the square of the previous minus {k}."

        question = f"Expert sequence — find the next: {', '.join(map(str, seq))}, __?"
        answer = str(next_val)

    return (
        "Pattern Recognition",
        "Analyze the sequence logic and supply the correct missing number.",
        question,
        [],
        "number",
        hint,
        answer
    )


# ══════════════════════════════════════════════════════════════
#  RIDDLES
# ══════════════════════════════════════════════════════════════
def generate_riddle(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Riddles based on difficulty."""
    if difficulty == "beginner":
        riddles = [
            ("What color is the sky on a clear day?", ["Blue", "Red", "Green", "Yellow"], "Blue", "Look up on a sunny day."),
            ("What do you use to write on paper?", ["Pencil", "Spoon", "Shoe", "Pillow"], "Pencil", "It has a pointed tip and leaves marks."),
            ("What animal says 'moo'?", ["Cow", "Dog", "Cat", "Bird"], "Cow", "You find it on a farm and it gives milk.")
        ]
    elif difficulty == "easy":
        riddles = [
            ("What has to be broken before you can use it?", ["Egg", "Glass", "Promise", "Code"], "Egg", "It has a shell and a yolk."),
            ("I'm tall when I'm young, and I'm short when I'm old. What am I?", ["Candle", "Tree", "Pencil", "Human"], "Candle", "It melts away as time passes."),
            ("What has hands, but cannot clap?", ["Clock", "Robot", "Statue", "Gloves"], "Clock", "It tells time on a dial.")
        ]
    elif difficulty == "medium":
        riddles = [
            ("I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", ["Echo", "Whistle", "Shadow", "Cloud"], "Echo", "Sound waves rebounding."),
            ("The more of this you take, the more you leave behind. What are they?", ["Footsteps", "Memories", "Photos", "Time"], "Footsteps", "Created as you walk."),
            ("What has a head and a tail, but no body?", ["Coin", "Snake", "Kite", "Comet"], "Coin", "Used in everyday currency.")
        ]
    elif difficulty == "hard":
        riddles = [
            ("The person who makes it has no need of it; the person who buys it has no use for it. The person who uses it can neither see nor feel it. What is it?", ["Coffin", "Air", "Mirror", "Crypt"], "Coffin", "Associated with final resting."),
            ("What can travel all around the world while remaining stuck in a single corner?", ["Stamp", "Letter", "Compass", "Satellite"], "Stamp", "Stuck on an envelope."),
            ("Forward I am heavy, but backward I am not. What am I?", ["Ton", "Net", "Star", "Boat"], "Ton", "Spelled backward, 'ton' becomes 'not'.")
        ]
    else:  # expert
        riddles = [
            ("I have cities, but no houses live there. I have mountains, but no trees grow. I have water, but no fish swim. I have roads, but no cars drive. What am I?", ["A map", "A dream", "A painting", "A mirror"], "A map", "It represents places without being them."),
            ("What is so fragile that saying its name breaks it?", ["Silence", "Glass", "Ice", "Trust"], "Silence", "The moment you speak, it ends."),
            ("The more you take, the more you leave behind. I'm not footsteps this time — I am taken from a mine, yet every room in your house has me. What am I?", ["Nothing", "Space", "Air", "Time"], "Nothing", "Mines contain nothing in their empty shafts, and every room has 'nothing' in it conceptually.")
        ]

    q, opts, ans, h = random.choice(riddles)
    
    return (
        "Cognitive Riddle",
        "Read the riddle carefully and select the correct solution.",
        q,
        opts,
        "choice",
        h,
        ans
    )


# ══════════════════════════════════════════════════════════════
#  QUICK QUIZZES
# ══════════════════════════════════════════════════════════════
def generate_quick_quiz(difficulty: str) -> Tuple[str, List[str], str, str, str]:
    """Generates Quick Quiz questions based on difficulty."""
    if difficulty == "beginner":
        quizzes = [
            ("How many days are in a week?", ["7", "5", "10", "6"], "7", "Monday through Sunday."),
            ("What color do you get when you mix red and blue?", ["Purple", "Green", "Orange", "Brown"], "Purple", "A classic color mixing question."),
            ("How many legs does a spider have?", ["8", "6", "4", "10"], "8", "Spiders are arachnids, not insects.")
        ]
    elif difficulty == "easy":
        quizzes = [
            ("What is the closest planet to the Sun in our solar system?", ["Mercury", "Venus", "Mars", "Earth"], "Mercury", "Innermost planet."),
            ("How many sides does a hexagon have?", ["6", "5", "8", "7"], "6", "Hexa- means six."),
            ("What is the primary gas found in the Earth's atmosphere?", ["Nitrogen", "Oxygen", "Carbon Dioxide", "Hydrogen"], "Nitrogen", "Makes up ~78% of air.")
        ]
    elif difficulty == "medium":
        quizzes = [
            ("What is the hardest natural substance found on Earth?", ["Diamond", "Titanium", "Quartz", "Granite"], "Diamond", "All-carbon crystalline lattice."),
            ("Which element has the chemical symbol 'O'?", ["Oxygen", "Gold", "Osmium", "Zinc"], "Oxygen", "Essential for respiration."),
            ("Which human organ consumes approximately 20% of the body's energy?", ["Brain", "Heart", "Liver", "Kidney"], "Brain", "Center of cognitive control.")
        ]
    elif difficulty == "hard":
        quizzes = [
            ("Which brain structure plays the primary role in memory consolidation and spatial navigation?", ["Hippocampus", "Amygdala", "Cerebellum", "Thalamus"], "Hippocampus", "Located in the medial temporal lobe."),
            ("What is the speed of light in a vacuum approximately equal to?", ["300,000 km/s", "150,000 km/s", "1,000,000 km/s", "30,000 km/s"], "300,000 km/s", "Exact: 299,792,458 m/s."),
            ("In computer science, what is the time complexity of binary search on a sorted array of size n?", ["O(log n)", "O(n)", "O(n²)", "O(1)"], "O(log n)", "Halves the search space at each step.")
        ]
    else:  # expert
        quizzes = [
            ("What is the Riemann Hypothesis primarily concerned with?", ["Distribution of prime numbers", "Geometry of curved surfaces", "Quantum wave functions", "Protein folding"], "Distribution of prime numbers", "It relates to the zeros of the Riemann zeta function and prime distribution."),
            ("In neuroscience, what does the default mode network (DMN) primarily activate during?", ["Rest and self-referential thought", "Active problem solving", "Sensory processing", "Motor execution"], "Rest and self-referential thought", "The DMN is most active when the brain is at rest and not focused outward."),
            ("What principle states that the position and momentum of a particle cannot both be known with perfect precision simultaneously?", ["Heisenberg Uncertainty Principle", "Pauli Exclusion Principle", "Schrödinger's Equation", "Bell's Theorem"], "Heisenberg Uncertainty Principle", "A fundamental limit in quantum mechanics established by Werner Heisenberg.")
        ]

    q, opts, ans, h = random.choice(quizzes)
    
    return (
        "Quick Brain Quiz",
        "Select the correct answer to activate your analytical thinking.",
        q,
        opts,
        "choice",
        h,
        ans
    )


# ══════════════════════════════════════════════════════════════
#  MASTER GENERATOR FUNCTION
# ══════════════════════════════════════════════════════════════
def generate_cognitive_challenge(challenge_type: str = "math", difficulty: str = "medium") -> ChallengeResponse:
    """Master factory function returning a formatted ChallengeResponse.
    Tries Gemini AI first, falls back to static generator if unavailable."""
    
    # Normalize inputs
    challenge_type = challenge_type.lower().strip()
    difficulty = difficulty.lower().strip()
    if difficulty not in ["beginner", "easy", "medium", "hard", "expert"]:
        difficulty = "medium"

    valid_types = ["math", "logic", "memory", "word", "pattern", "riddle", "quiz"]
    if challenge_type == "random" or challenge_type not in valid_types:
        challenge_type = random.choice(valid_types)

    time_limits = {"beginner": 60, "easy": 45, "medium": 35, "hard": 25, "expert": 15}
    cid = f"chal_{uuid.uuid4().hex[:8]}"

    # ── Try Gemini first ─────────────────────────────────────
    gemini_result = generate_with_gemini(challenge_type, difficulty)
    if gemini_result:
        type_titles = {
            "math":    "Math Challenge",
            "logic":   "Logic Puzzle",
            "memory":  "Memory Challenge",
            "word":    "Word Challenge",
            "pattern": "Pattern Recognition",
            "riddle":  "Cognitive Riddle",
            "quiz":    "Quick Brain Quiz",
        }
        type_instructions = {
            "math":    "Calculate the correct numerical answer mentally as fast as possible.",
            "logic":   "Analyze the logic problem carefully and select the correct answer.",
            "memory":  "Memorize the sequence, then enter it in the required order.",
            "word":    "Unscramble the letters to form the correct target word.",
            "pattern": "Analyze the sequence logic and supply the correct missing number.",
            "riddle":  "Read the riddle carefully and select the correct solution.",
            "quiz":    "Select the correct answer to activate your analytical thinking.",
        }
        options = gemini_result.get("options") or []
        in_type = "choice" if options else ("number" if challenge_type in ["math", "pattern"] else "text")

        return ChallengeResponse(
            challenge_id=cid,
            type=challenge_type,
            difficulty=difficulty,
            title=type_titles.get(challenge_type, "Cognitive Challenge"),
            instructions=type_instructions.get(challenge_type, "Solve the challenge."),
            question=gemini_result["question"],
            options=options if options else None,
            input_type=in_type,
            hint=gemini_result.get("hint", "Think carefully."),
            time_limit=time_limits.get(difficulty, 45),
            answer_key=str(gemini_result["answer"])
        )

    # ── Fallback: static generator ───────────────────────────
    if challenge_type == "math":
        title, inst, q, opts, in_type, hint, ans = generate_math_problem(difficulty)
    elif challenge_type == "logic":
        title, inst, q, opts, in_type, hint, ans = generate_logic_puzzle(difficulty)
    elif challenge_type == "memory":
        title, inst, q, opts, in_type, hint, ans = generate_memory_challenge(difficulty)
    elif challenge_type == "word":
        title, inst, q, opts, in_type, hint, ans = generate_word_game(difficulty)
    elif challenge_type == "pattern":
        title, inst, q, opts, in_type, hint, ans = generate_pattern_recognition(difficulty)
    elif challenge_type == "riddle":
        title, inst, q, opts, in_type, hint, ans = generate_riddle(difficulty)
    elif challenge_type == "quiz":
        title, inst, q, opts, in_type, hint, ans = generate_quick_quiz(difficulty)
    else:
        title, inst, q, opts, in_type, hint, ans = generate_math_problem(difficulty)

    return ChallengeResponse(
        challenge_id=cid,
        type=challenge_type,
        difficulty=difficulty,
        title=title,
        instructions=inst,
        question=q,
        options=opts if opts else None,
        input_type=in_type,
        hint=hint,
        time_limit=time_limits.get(difficulty, 45),
        answer_key=str(ans)
    )
