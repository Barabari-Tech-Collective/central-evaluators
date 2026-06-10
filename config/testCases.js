let testCases;
export default testCases = [
  {
    input: -1,
    expected: false,
    description: 'negative number is not prime',
  },
  {
    input: 0,
    expected: false,
    description: 'zero is not prime',
  },
  {
    input: 1,
    expected: false,
    description: 'one is not prime',
  },
  {
    input: 2,
    expected: true,
    description: 'two is prime',
  },
  {
    input: 3,
    expected: true,
    description: 'three is prime',
  },
  {
    input: 4,
    expected: false,
    description: 'four is composite',
  },
  {
    input: 17,
    expected: true,
    description: 'prime number seventeen',
  },
  {
    input: 18,
    expected: false,
    description: 'composite number eighteen',
  },
  {
    input: 19,
    expected: true,
    description: 'prime number nineteen',
  },
  {
    input: 20,
    expected: false,
    description: 'composite number twenty',
  },
  {
    input: 97,
    expected: true,
    description: 'larger prime number ninety-seven',
  },
  {
    input: 100,
    expected: false,
    description: 'round composite number one hundred',
  },
];
