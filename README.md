# TXT to JSON Processor

A web application that processes TXT files into JSON format and stores them in a Postgres database.

## Features

- Upload and process TXT files with semicolon-separated values
- Parse file content into structured JSON data
- Store processed data in Vercel Postgres database
- View uploaded files and their processed data
- Add weight values to processed data

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript, EJS templates, Bootstrap
- **Backend**: Node.js, Express.js
- **Database**: Vercel Postgres
- **Deployment**: Vercel
- **Version Control**: GitHub

## Getting Started

### Prerequisites

- Node.js 14.x or higher
- npm or yarn
- Vercel account
- GitHub account

### Local Development

1. Clone the repository:
   ```
   git clone <your-repo-url>
   cd txt-to-json-processor
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your Postgres connection string:
   ```
   POSTGRES_URL=your_postgres_connection_string_here
   ```

4. Start the development server:
   ```
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Deployment to Vercel

1. Push your code to GitHub
2. Connect your Vercel account to your GitHub repository
3. Configure the Vercel Postgres database
4. Deploy from the Vercel dashboard

## Project Structure

```
txt-to-json-processor/
├── app.js              # Main application file
├── package.json        # Node.js dependencies
├── public/             # Static files
├── views/              # EJS templates
│   ├── index.ejs       # Home page template
│   └── fileData.ejs    # File data page template
└── README.md           # Project documentation
```

## License

[MIT](LICENSE)