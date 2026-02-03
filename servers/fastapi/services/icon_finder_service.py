import asyncio
import json
import os
from fastembed_vectorstore import FastembedEmbeddingModel, FastembedVectorstore


class IconFinderService:
    def __init__(self):
        self.model = FastembedEmbeddingModel.AllMiniLML6V2
        self.cache_directory = "fastembed_cache"
        self.vectorstore = None
        self._initialized = False

    def _initialize_icons_collection(self):
        if self._initialized:
            return
            
        print("Initializing icons collection...")
        try:
            icons_vectorstore_path = "assets/icons-vectorstore.json"
            if os.path.exists(icons_vectorstore_path):
                self.vectorstore = FastembedVectorstore.load(
                    self.model, icons_vectorstore_path, cache_directory=self.cache_directory
                )
            else:
                self.vectorstore = FastembedVectorstore(
                    self.model, cache_directory=self.cache_directory
                )
                icons_path = "assets/icons.json"
                with open(icons_path, "r") as f:
                    icons = json.load(f)

                documents = []

                for each in icons["icons"]:
                    if each["name"].split("-")[-1] == "bold":
                        doc_text = f"{each['name']}||{each['tags']}"
                        documents.append(doc_text)

                if documents:
                    success = self.vectorstore.embed_documents(documents)
                    if success:
                        print(f"Successfully embedded {len(documents)} icons")
                        self.vectorstore.save(icons_vectorstore_path)
                    else:
                        print(f"Failed to embed {len(documents)} icons")
            
            self._initialized = True
            print("Icons collection initialized.")
        except Exception as e:
            print(f"Warning: Could not initialize icon finder service: {e}")
            print("Icon search will be disabled.")

    async def search_icons(self, query: str, k: int = 1):
        if not self._initialized:
            self._initialize_icons_collection()
        
        if not self.vectorstore:
            # Return empty list if vectorstore failed to initialize
            return []
            
        try:
            result = await asyncio.to_thread(self.vectorstore.search, query, k)
            return [
                f"/static/icons/bold/{each[0].split('||')[0]}.svg"
                for each in result
            ]
        except Exception as e:
            print(f"Icon search error: {e}")
            return []


ICON_FINDER_SERVICE = IconFinderService()
